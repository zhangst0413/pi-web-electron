import assert from "node:assert/strict";
import test from "node:test";

import {
  formatRelativeTime,
  formatShortRelativeTime,
  formatUpdatedTime,
  interpolateMessage,
  translateMessage,
} from "./format.ts";

test("interpolates string and numeric parameters", () => {
  assert.equal(interpolateMessage("你好，{name}（{count}）", { name: "Pi", count: 2 }), "你好，Pi（2）");
});

test("returns the key when the translation is missing", () => {
  assert.equal(translateMessage("zh-CN", "common.ok", { "zh-CN": { "common.ok": "确定" } }), "确定");
  assert.equal(translateMessage("zh-CN", "missing.key", { "zh-CN": {} }), "missing.key");
});

test("formats relative time using Simplified Chinese", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(formatRelativeTime(new Date("2026-01-01T00:05:00.000Z"), "zh-CN", now), "5分钟后");
  assert.equal(formatRelativeTime(new Date("2025-12-31T23:00:00.000Z"), "zh-CN", now), "1小时前");
});

test("shows a clock time today and a relative day for earlier updates", () => {
  const now = new Date(2026, 8, 22, 21, 18, 0);
  const today = new Date(2026, 8, 22, 9, 5, 0);
  const earlier = new Date(2026, 8, 19, 21, 18, 0);
  assert.equal(
    formatUpdatedTime(today.getTime(), "zh-CN", now),
    today.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
  );
  assert.equal(formatUpdatedTime(earlier.getTime(), "zh-CN", now), "3天前");
});

test("formats compact sidebar times in Simplified Chinese", () => {
  const now = new Date("2026-10-07T12:00:00.000Z");
  const ago = (ms) => new Date(now.getTime() - ms);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const cases = [
    [ago(59_999), "刚刚"],
    [ago(minute), "1分"],
    [ago(59 * minute), "59分"],
    [ago(hour), "1小时"],
    [ago(23 * hour + 59 * minute), "23小时"],
    [ago(day), "1天"],
    [ago(6 * day), "6天"],
    [ago(7 * day), "1周"],
    [ago(29 * day), "4周"],
    [ago(30 * day), "1个月"],
    [ago(364 * day), "12个月"],
    [ago(365 * day), "1年"],
    [ago(800 * day), "2年"],
  ];
  for (const [date, expected] of cases) {
    assert.equal(formatShortRelativeTime(date, "zh-CN", now), expected);
  }
});

test("compact sidebar times accept ISO strings and tolerate odd input", () => {
  const now = new Date("2026-10-07T12:00:00.000Z");
  assert.equal(formatShortRelativeTime("2026-10-07T09:30:00.000Z", "zh-CN", now), "2小时");
  assert.equal(formatShortRelativeTime("2026-10-08T12:00:00.000Z", "zh-CN", now), "刚刚", "future dates count as now");
  assert.equal(formatShortRelativeTime("not a date", "zh-CN", now), "");
  assert.equal(formatShortRelativeTime(new Date(Number.NaN), "zh-CN", now), "");
  assert.equal(formatShortRelativeTime("2026-10-07T11:55:00.000Z", "fr", now), "5分", "unknown locales use Simplified Chinese");
});
