import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import ts from "typescript";
import { supportedLocale, translate, translator } from "../src/lib/i18n";
import { messages } from "../src/lib/i18n-messages";

test("Korean is the default; English and Japanese preserve amounts, codes and dynamic messages", () => {
  for (const value of [undefined, "fr", "en-US", "<script>", ""]) assert.equal(supportedLocale(value), "ko");
  assert.equal(supportedLocale("en"), "en");
  assert.equal(supportedLocale("ja"), "ja");
  assert.equal(translate("ko", " 회원가 "), " 회원가 ");
  assert.equal(translate("ko", "  "), "  ");
  assert.equal(translate("en", "회원가"), "Member price");
  assert.equal(translate("ja", "회원가"), "会員価格");
  assert.equal(translate("en", "구매가 완료되었습니다. 주문번호 {0}", { 0: "ORDER-ABC123" }), "Purchase completed. Order ID ORDER-ABC123");
  assert.equal(translate("ja", "최소 출금 금액은 10.000001 USDT입니다."), "最低出金額は10.000001 USDTです。");
  assert.equal(translate("en", "추천링크를 복사했습니다."), "Referral link copied.");
  for (const locale of ["ko", "en", "ja"] as const) {
    for (const value of ["TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", "ABCDEF123456", "88000.000001", "山田 太郎", "사용자가 작성한 이름"]) assert.equal(translate(locale, value), value);
    assert.equal(translator(locale)(null), "");
  }
});

test("English and Japanese dictionary entries retain every interpolation and all referenced UI copy is covered", async () => {
  const tokens = (value: string) => [...new Set([...value.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]))].sort();
  for (const [key, values] of Object.entries(messages)) {
    assert.equal(values.length, 2, key);
    for (const value of values) {
      assert.ok(value.trim(), key);
      assert.deepEqual(tokens(value), tokens(key), "Interpolation mismatch: " + key);
    }
  }
  async function files(dir: string): Promise<string[]> {
    return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(e => e.isDirectory() ? files(`${dir}/${e.name}`) : /\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : []))).flat();
  }
  const missing = new Set<string>();
  for (const file of await files("src")) {
    if (file.endsWith("i18n-messages.ts")) continue;
    const source = await readFile(file, "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.getText(ast) === "tr" && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
        const key = node.arguments[0].text.trim();
        if (/[가-힣]/.test(key) && !messages[key]) missing.add(key);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  assert.deepEqual([...missing], []);
});
