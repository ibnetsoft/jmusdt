import { z } from "zod";
export const imageUrlSchema = z
  .string()
  .url()
  .max(2000)
  .refine((value) => value.startsWith("https://"));
export const detailBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("heading"),
    text: z.string().trim().min(1).max(200),
  }),
  z.object({
    type: z.literal("text"),
    text: z.string().trim().min(1).max(5000),
  }),
  z.object({
    type: z.literal("image"),
    url: imageUrlSchema,
    alt: z.string().max(200),
    caption: z.string().max(500),
  }),
]);
export const detailBlocksSchema = z.array(detailBlockSchema).max(30);
export type DetailBlock = z.infer<typeof detailBlockSchema>;
