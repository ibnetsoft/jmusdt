"use client";
import { useParams } from "next/navigation";
import { Shop } from "@/components/shop";
export default function Loading() {
  const { id } = useParams<{ id: string }>();
  return <Shop productId={id} preview />;
}
