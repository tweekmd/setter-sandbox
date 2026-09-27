import test from "node:test";
import assert from "node:assert/strict";
import {
	createInitialView,
	fallbackTurn,
	isQualified,
	sanitizeAgentView,
	validateAgentOutput,
} from "../src/conversation.js";

const slots = ["Tuesday, 6:00 PM EET", "Thursday, 12:30 PM EET"];

function output(overrides = {}) {
	return {
		reply: "That sounds like a meaningful goal. What does a usual week look like?",
		stage: "qualifying",
		lead: {
			level: "New runner",
			goal: "First half marathon",
			deadline: "October",
			blocker: "Hard to stay consistent",
			timePerWeek: "Three 30-minute sessions",
			readiness: "ready",
		},
		score: 78,
		scoreReason: "Clear goal, workable schedule, and ready to get support.",
		bookingSlot: null,
		...overrides,
	};
}

test("validates structured lead output and strips control characters", () => {
	const result = validateAgentOutput(output({ reply: "  Hello\nthere  " }), createInitialView(), slots);
	assert.equal(result.valid, true);
	assert.equal(result.value.reply, "Hello there");
	assert.equal(result.value.view.stage, "qualifying");
	assert.equal(isQualified(result.value.view.lead), true);
});

test("rejects malformed JSON and produces a graceful fallback", () => {
	assert.equal(validateAgentOutput("not json", createInitialView()).valid, false);
	assert.match(fallbackTurn(createInitialView()).reply, /lost my place/);
});

test("prevents booking until qualification is complete", () => {
	const unqualified = output({
		stage: "booking",
		lead: { ...output().lead, deadline: null },
	});
	const prior = { ...createInitialView(), stage: "qualifying" };
	const fromQualifying = validateAgentOutput(unqualified, prior, slots);
	const fromOpener = validateAgentOutput(unqualified, createInitialView(), slots);
	assert.equal(fromQualifying.reason, "not-qualified-to-book");
	assert.equal(fromOpener.reason, "not-qualified-to-book");
	assert.equal(fromOpener.recoveredView.stage, "qualifying");
	assert.equal(fromOpener.recoveredView.lead.goal, "First half marathon");
});

test("requires an allowed offered slot to mark a lead booked", () => {
	const prior = { ...createInitialView(), stage: "booking", lead: output().lead };
	const booked = output({ stage: "booked", bookingSlot: "Next Tuesday at noon" });
	assert.equal(validateAgentOutput(booked, prior, slots).reason, "invalid-booking");
});

test("disqualifies leads who are not ready and rejects invalid transitions", () => {
	const notReady = output({
		stage: "disqualified",
		lead: { ...output().lead, readiness: "not_ready" },
	});
	assert.equal(validateAgentOutput(notReady, createInitialView(), slots).valid, true);
	assert.equal(validateAgentOutput(output({ stage: "booked" }), createInitialView(), slots).valid, false);
});

test("sanitizes client state and carries forward previously extracted fields", () => {
	const previous = {
		...createInitialView(),
		stage: "booking",
		lead: output().lead,
	};
	const safe = sanitizeAgentView({ ...previous, stage: "booked", bookingSlot: "made up" }, slots);
	assert.equal(safe.stage, "booking");
	const result = validateAgentOutput(output({
		stage: "booking",
		lead: { ...output().lead, deadline: null },
	}), previous, slots);
	assert.equal(result.value.view.lead.deadline, "October");
});

test("keeps a qualified lead score from collapsing when the model under-scores it", () => {
	const result = validateAgentOutput(output({ score: 4 }), createInitialView(), slots);
	assert.equal(result.valid, true);
	assert.equal(result.value.view.score, 85);
});

test("recovers a complete lead into the two-slot booking stage", () => {
	const complete = {
		stage: "qualifying",
		lead: output().lead,
		score: 85,
		scoreReason: "A strong fit.",
		bookingSlot: null,
	};
	const recovered = fallbackTurn(complete, slots);
	assert.equal(recovered.view.stage, "booking");
	assert.match(recovered.reply, /Tuesday, 6:00 PM EET.*Thursday, 12:30 PM EET/);
	assert.equal(recovered.view.bookingSlot, null);
});

test("treats omitted fields as unknown and normalizes plain-language readiness", () => {
	const candidate = output({
		stage: "qualifying",
		lead: { ...output().lead, readiness: "I am ready to invest now" },
	});
	delete candidate.lead.blocker;
	const result = validateAgentOutput(candidate, createInitialView(), slots);
	assert.equal(result.valid, true);
	assert.equal(result.value.view.lead.readiness, "ready");
	assert.equal(result.value.view.lead.blocker, null);
});