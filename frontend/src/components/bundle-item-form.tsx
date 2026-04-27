"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CreatableCombobox } from "@/components/creatable-combobox";
import {
  fetchApprovedBrands,
  fetchApprovedArticles,
  createBrandPending,
  createArticlePending,
} from "@/lib/queries";

export interface BundleItemFormValues {
  gender: string;
  brand: string;
  article: string;
  number_of_pieces: number;
  gift_pcs: number;
  grade: string;
  size_variation: string;
  comments: string;
}

export const EMPTY_ITEM: BundleItemFormValues = {
  gender: "Unisex",
  brand: "",
  article: "",
  number_of_pieces: 0,
  gift_pcs: 0,
  grade: "A/B",
  size_variation: "XS-XXL",
  comments: "",
};

const GENDERS = ["Men", "Women", "Unisex", "Kids"];
const GRADES = ["A", "B", "C", "A/B", "B/C", "A/B/C"];

interface BundleItemFormProps {
  value: BundleItemFormValues;
  onChange: (next: BundleItemFormValues) => void;
  disabled?: boolean;
}

export function BundleItemForm({ value, onChange, disabled }: BundleItemFormProps) {
  const brandsQuery = useQuery({
    queryKey: ["catalog", "brands"],
    queryFn: fetchApprovedBrands,
    staleTime: 60_000,
  });

  const articlesQuery = useQuery({
    queryKey: ["catalog", "articles"],
    queryFn: fetchApprovedArticles,
    staleTime: 60_000,
  });

  const approvedBrands = brandsQuery.data ?? [];
  const approvedArticles = articlesQuery.data ?? [];

  const brandIsPending =
    !!value.brand &&
    !approvedBrands.some((b) => b.name.toLowerCase() === value.brand.toLowerCase());

  const articleIsPending =
    !!value.article &&
    !approvedArticles.some((a) => a.name.toLowerCase() === value.article.toLowerCase());

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Gender</Label>
        <Select
          value={value.gender}
          onChange={(e) => onChange({ ...value, gender: e.target.value })}
          disabled={disabled}
        >
          {GENDERS.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Brand</Label>
        <CreatableCombobox
          value={value.brand}
          onChange={(v) => onChange({ ...value, brand: v })}
          options={approvedBrands}
          onCreatePending={async (name) => {
            await createBrandPending(name);
            await brandsQuery.refetch();
          }}
          placeholder="Select brand…"
          disabled={disabled}
          isPending={brandIsPending}
        />
      </div>
      <div className="space-y-2">
        <Label>Article</Label>
        <CreatableCombobox
          value={value.article}
          onChange={(v) => onChange({ ...value, article: v })}
          options={approvedArticles}
          onCreatePending={async (name) => {
            await createArticlePending(name);
            await articlesQuery.refetch();
          }}
          placeholder="Select article…"
          disabled={disabled}
          isPending={articleIsPending}
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-2">
          <Label>Pieces *</Label>
          <Input
            type="number"
            inputMode="numeric"
            value={value.number_of_pieces || ""}
            onChange={(e) => onChange({ ...value, number_of_pieces: parseInt(e.target.value || "0", 10) })}
            disabled={disabled}
          />
        </div>
        <div className="space-y-2">
          <Label>Gift Pcs</Label>
          <Input
            type="number"
            inputMode="numeric"
            value={value.gift_pcs || ""}
            onChange={(e) => onChange({ ...value, gift_pcs: parseInt(e.target.value || "0", 10) })}
            disabled={disabled}
          />
        </div>
        <div className="space-y-2">
          <Label>Grade</Label>
          <Select
            value={value.grade}
            onChange={(e) => onChange({ ...value, grade: e.target.value })}
            disabled={disabled}
          >
            {GRADES.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label>Size Variation *</Label>
        <Input
          value={value.size_variation}
          onChange={(e) => onChange({ ...value, size_variation: e.target.value })}
          placeholder="e.g. XS-XXL"
          disabled={disabled}
        />
      </div>
      <div className="space-y-2">
        <Label>Comments</Label>
        <Textarea
          value={value.comments}
          onChange={(e) => onChange({ ...value, comments: e.target.value })}
          placeholder="optional"
          disabled={disabled}
        />
      </div>
    </div>
  );
}

export function validateItem(v: BundleItemFormValues): string | null {
  if (!v.brand.trim()) return "Brand is required.";
  if (!v.article.trim()) return "Article is required.";
  if (!v.size_variation.trim()) return "Size variation is required.";
  if (v.number_of_pieces <= 0) return "Pieces must be greater than zero.";
  return null;
}
