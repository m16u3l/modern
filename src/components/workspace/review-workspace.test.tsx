// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewWorkspace } from "./review-workspace";
import {
  FIXTURE_ISSUES,
  FIXTURE_ROWS,
  FIXTURE_SUGGESTIONS,
  FIXTURE_SUMMARY,
} from "@/lib/fixtures";
import { LOW_CONFIDENCE_THRESHOLD } from "@/lib/contracts";

function renderWorkspace() {
  return render(
    <ReviewWorkspace
      summary={FIXTURE_SUMMARY}
      rows={FIXTURE_ROWS}
      issues={FIXTURE_ISSUES}
      suggestions={FIXTURE_SUGGESTIONS}
    />,
  );
}

/** Reads the "N pending" counter out of the dataset health bar. */
function pendingCount(): number {
  const label = screen.getByText("pending");
  return Number(label.previousElementSibling!.textContent);
}

beforeEach(cleanup);

describe("ReviewWorkspace", () => {
  it("collapses suggestions into a handful of reviewable patterns", () => {
    renderWorkspace();
    const heading = screen.getByText(/patterns to review/);
    const groupCount = Number(heading.textContent!.match(/^(\d+)/)![1]);

    expect(groupCount).toBeGreaterThan(1);
    expect(groupCount).toBeLessThan(FIXTURE_SUGGESTIONS.length / 3);
  });

  it("starts with every suggestion pending", () => {
    renderWorkspace();
    expect(pendingCount()).toBe(FIXTURE_SUGGESTIONS.length);
  });

  it("accepts the focused suggestion with the A key and advances", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    const before = pendingCount();
    await user.keyboard("a");

    expect(pendingCount()).toBe(before - 1);
    expect(screen.getAllByText("Accepted").length).toBe(1);
  });

  it("rejects with the R key", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.keyboard("r");

    expect(screen.getAllByText("Rejected").length).toBe(1);
  });

  it("undoes a keyboard decision with Cmd+Z", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    const before = pendingCount();
    await user.keyboard("a");
    expect(pendingCount()).toBe(before - 1);

    await user.keyboard("{Meta>}z{/Meta}");
    expect(pendingCount()).toBe(before);
  });

  it("navigates between suggestions with the arrow keys", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    const cards = () => screen.getAllByTestId("suggestion-card");
    expect(cards()[0].className).toContain("ring-2");

    await user.keyboard("{ArrowDown}");
    expect(cards()[0].className).not.toContain("ring-2");
    expect(cards()[1].className).toContain("ring-2");

    await user.keyboard("{ArrowUp}");
    expect(cards()[0].className).toContain("ring-2");
  });

  it("bulk accepts a group and leaves low-confidence items pending", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    // Pick a group that deliberately holds some suggestions back.
    const mixedGroup = screen
      .getAllByRole("listitem")
      .find((item) => within(item).queryByText(/need a look/));
    expect(mixedGroup).toBeDefined();

    const acceptAll = within(mixedGroup!).getByRole("button", {
      name: /Accept all/,
    });
    const claimed = Number(acceptAll.textContent!.match(/\((\d+)\)/)![1]);
    const before = pendingCount();

    await user.click(acceptAll);

    expect(pendingCount()).toBe(before - claimed);
    // The held-back ones are still there to be decided one by one.
    expect(within(mixedGroup!).getByText(/left$/)).toBeInTheDocument();
  });

  it("never bulk-accepts anything below the confidence threshold", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    for (const item of screen.getAllByRole("listitem")) {
      const button = within(item).queryByRole("button", { name: /Accept all/ });
      if (button && !button.hasAttribute("disabled")) await user.click(button);
    }

    // Everything still pending must be a suggestion the bulk path skips.
    const stillPending = pendingCount();
    const heldBack = FIXTURE_SUGGESTIONS.filter(
      (s) => s.confidence < LOW_CONFIDENCE_THRESHOLD || s.action === "no_action",
    ).length;

    expect(stillPending).toBe(heldBack);
  });

  it("does not open an editor for suggestions with no value to edit", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    // The first group is the duplicates one, whose only action is deleting rows.
    await user.click(
      screen.getByRole("button", { name: /Possible duplicates/ }),
    );
    await user.keyboard("e");

    expect(
      screen.queryByLabelText("Override the proposed value"),
    ).not.toBeInTheDocument();
  });

  it("lets the reviewer override a proposed value inline", async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(
      screen.getByRole("button", { name: /Inconsistent format . column "phone"/ }),
    );
    await user.keyboard("e");
    const input = screen.getByLabelText("Override the proposed value");
    await user.clear(input);
    await user.type(input, "manual value{Enter}");

    expect(screen.getAllByText("Edited").length).toBe(1);
    expect(screen.getByTitle("manual value")).toBeInTheDocument();
  });

  it("shows the row's fields in the dataset's column order, not the row's own", () => {
    // Rows come back from jsonb with their keys reordered, so the record has to
    // be laid out from the dataset's columns or the reviewer reads a scrambled
    // version of it.
    const scrambled = FIXTURE_ROWS.map((row) => ({
      ...row,
      data: Object.fromEntries(
        Object.entries(row.data).sort(([a], [b]) => a.localeCompare(b)),
      ),
    }));

    render(
      <ReviewWorkspace
        summary={FIXTURE_SUMMARY}
        rows={scrambled}
        issues={FIXTURE_ISSUES}
        suggestions={FIXTURE_SUGGESTIONS}
      />,
    );

    const card = screen.getAllByTestId("suggestion-card")[0];
    const labels = within(card)
      .getAllByRole("term")
      .map((term) => term.textContent);

    expect(labels).toEqual(FIXTURE_SUMMARY.columns.map((column) => column.key));
  });

  it("reaches zero pending and offers to apply", async () => {
    const user = userEvent.setup();
    render(
      <ReviewWorkspace
        summary={FIXTURE_SUMMARY}
        rows={FIXTURE_ROWS}
        issues={FIXTURE_ISSUES}
        suggestions={FIXTURE_SUGGESTIONS}
        onApply={() => {}}
      />,
    );

    // Reject-all has no confidence gate, so it can clear the whole backlog.
    let guard = 0;
    while (pendingCount() > 0 && guard++ < 40) {
      const next = screen
        .getAllByRole("listitem")
        .find((item) => within(item).queryByRole("button", { name: /Reject all/ }));
      if (!next) break;
      await user.click(
        within(next).getByRole("button", { name: /Reject all/ }),
      );
    }

    expect(pendingCount()).toBe(0);
    expect(
      screen.getByText(/Every suggestion has a decision/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Apply & export/ }),
    ).toBeInTheDocument();
  });
});
