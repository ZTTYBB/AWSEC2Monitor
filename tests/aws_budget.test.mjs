import assert from "node:assert/strict"
import test from "node:test"
import { getDailyBudget } from "../aws_budget.ts"

function snapshot(remainingGB, monthKey = "2026-10") {
  return { monthKey, remainingGB }
}

test("matches the screenshot reference with today included", () => {
  const result = getDailyBudget(snapshot(178.6), new Date("2026-10-03T06:13:00Z"))
  assert.equal(result.remainingDays, 29)
  assert.equal(result.dailyAvailableGB.toFixed(2), "6.16")
})

test("shows the AWS daily budget in the same units as the remaining traffic", () => {
  const result = getDailyBudget(snapshot(90.71), new Date("2026-10-03T06:12:00Z"))
  assert.equal(result.remainingDays, 29)
  assert.equal(result.dailyAvailableGB.toFixed(2), "3.13")
})

test("counts every day of the month on the first day", () => {
  assert.deepEqual(getDailyBudget(snapshot(93), new Date("2026-10-01T00:00:00Z")), {
    remainingDays: 31,
    dailyAvailableGB: 3
  })
})

test("the last day still has one day of available budget", () => {
  assert.deepEqual(getDailyBudget(snapshot(4.5), new Date("2026-10-31T23:59:59Z")), {
    remainingDays: 1,
    dailyAvailableGB: 4.5
  })
})

test("handles thirty-day months", () => {
  assert.deepEqual(getDailyBudget(snapshot(30, "2026-04"), new Date("2026-04-01T00:00:00Z")), {
    remainingDays: 30,
    dailyAvailableGB: 1
  })
})

test("handles February in non-leap years", () => {
  assert.deepEqual(getDailyBudget(snapshot(56, "2026-02"), new Date("2026-02-01T00:00:00Z")), {
    remainingDays: 28,
    dailyAvailableGB: 2
  })
})

test("handles leap-day February", () => {
  assert.deepEqual(getDailyBudget(snapshot(58, "2028-02"), new Date("2028-02-01T00:00:00Z")), {
    remainingDays: 29,
    dailyAvailableGB: 2
  })
  assert.deepEqual(getDailyBudget(snapshot(2, "2028-02"), new Date("2028-02-29T23:59:59Z")), {
    remainingDays: 1,
    dailyAvailableGB: 2
  })
})

test("uses the UTC day when the local calendar day is different", () => {
  const result = getDailyBudget(snapshot(58), new Date("2026-10-04T00:30:00+08:00"))
  assert.equal(result.remainingDays, 29)
  assert.equal(result.dailyAvailableGB, 2)
})

test("rejects an old-month snapshot at the UTC month boundary", () => {
  const result = getDailyBudget(snapshot(58), new Date("2026-11-01T00:00:00Z"))
  assert.equal(result, null)
})

test("rejects future-month and malformed snapshots", () => {
  const now = new Date("2026-10-03T00:00:00Z")
  assert.equal(getDailyBudget(snapshot(10, "2026-11"), now), null)
  assert.equal(getDailyBudget(snapshot(10, ""), now), null)
  assert.equal(getDailyBudget(snapshot(10, "2026-13"), now), null)
})

test("has no negative daily budget when the threshold is exhausted", () => {
  const now = new Date("2026-10-03T00:00:00Z")
  assert.equal(getDailyBudget(snapshot(0), now).dailyAvailableGB, 0)
  assert.equal(getDailyBudget(snapshot(-5), now).dailyAvailableGB, 0)
})

test("rejects missing or non-finite data instead of claiming zero budget", () => {
  const now = new Date("2026-10-03T00:00:00Z")
  for (const value of [null, undefined, snapshot(NaN), snapshot(Infinity), snapshot(undefined)]) {
    assert.equal(getDailyBudget(value, now), null)
  }
})

test("rejects an invalid date", () => {
  assert.equal(getDailyBudget(snapshot(10), new Date("invalid")), null)
})

test("recalculates after a day boundary without changing stored data", () => {
  const data = Object.freeze(snapshot(28))
  const first = getDailyBudget(data, new Date("2026-10-03T23:59:59Z"))
  const second = getDailyBudget(data, new Date("2026-10-04T00:00:00Z"))
  assert.equal(first.remainingDays, 29)
  assert.equal(second.remainingDays, 28)
  assert.equal(second.dailyAvailableGB, 1)
  assert.deepEqual(data, snapshot(28))
})
