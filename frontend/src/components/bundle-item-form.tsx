"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

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
  gender: "Men",
  brand: "",
  article: "",
  number_of_pieces: 0,
  gift_pcs: 0,
  grade: "A",
  size_variation: "",
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
        <Label>Brand(s)</Label>
        <Input
          value={value.brand}
          onChange={(e) => onChange({ ...value, brand: e.target.value })}
          placeholder="e.g. Nike, Adidas"
          disabled={disabled}
        />
      </div>
      <div className="space-y-2">
        <Label>Article(s)</Label>
        <Input
          value={value.article}
          onChange={(e) => onChange({ ...value, article: e.target.value })}
          placeholder="e.g. Hoodie, T-Shirt"
          disabled={disabled}
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
          placeholder="e.g. S to XXL"
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
