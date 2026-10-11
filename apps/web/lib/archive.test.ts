import type { ArchiveItem } from "@blog/shared";
import { describe, expect, it } from "vitest";
import { formatArchiveDay, groupArchive } from "./archive";

const item = (slug: string, publishedAt: string): ArchiveItem => ({ slug, title: slug, publishedAt, locale: "zh" });

describe("groupArchive", () => {
  it("groups by year and month in the site's time zone, keeping the order", () => {
    const items = [
      item("c", "2026-03-10T00:00:00Z"),
      // 北京时间 2026-03-01 07:00：属于 3 月
      item("b", "2026-02-28T23:00:00Z"),
      item("a", "2026-02-10T00:00:00Z"),
      // 北京时间 2026-01-01 00:30：属于 2026 年
      item("new-year", "2025-12-31T16:30:00Z"),
      item("old", "2025-11-05T00:00:00Z"),
    ];
    const years = groupArchive(items, "zh");
    expect(years.map((y) => [y.year, y.label, y.months.map((m) => [m.key, m.label, m.items.map((i) => i.slug)])])).toEqual([
      [
        "2026",
        "2026年",
        [
          ["2026-03", "三月", ["c", "b"]],
          ["2026-02", "二月", ["a"]],
          ["2026-01", "一月", ["new-year"]],
        ],
      ],
      ["2025", "2025年", [["2025-11", "十一月", ["old"]]]],
    ]);
  });

  it("labels months and years in the page language", () => {
    const [year] = groupArchive([item("a", "2026-03-10T00:00:00Z")], "en");
    expect(year?.label).toBe("2026");
    expect(year?.months[0]?.label).toBe("March");
    expect(groupArchive([item("a", "2026-03-10T00:00:00Z")], "ja")[0]?.months[0]?.label).toBe("3月");
  });

  it("returns nothing for no posts", () => {
    expect(groupArchive([], "zh")).toEqual([]);
  });
});

describe("formatArchiveDay", () => {
  it("shows month and day in the site's time zone", () => {
    expect(formatArchiveDay("2026-02-28T23:00:00Z", "en")).toBe("Mar 1");
    expect(formatArchiveDay("2026-02-28T23:00:00Z", "ja")).toBe("3月1日");
  });
});
