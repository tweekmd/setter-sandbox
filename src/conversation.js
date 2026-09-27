export const STAGES = [
	"opener",
	"qualifying",
	"objection",
	"booking",
	"booked",
	"disqualified",
];

export const LEAD_FIELDS = [
	"level",
	"goal",
	"deadline",
	"blocker",
	"timePerWeek",
	"readiness",
];

const TRANSITIONS = {
	opener: ["opener", "qualifying", "objection", "booking", "disqualified"],
	qualifying: ["qualifying", "objection", "booking", "disqualified"],
	objection: ["qualifying", "objection", "booking", "disqualified"],
	booking: ["booking", "booked", "disqualified"],
	booked: ["booked"],
	disqualified: ["disqualified"],
};

const EMPTY_LEAD = Object.freeze({
	level: null,
	goal: null,
	deadline: null,
	blocker: null,
	timePerWeek: null,
	readiness: null,
});

export function createInitialView() {
	return {
		stage: "opener",
		lead: { ...EMPTY_LEAD },
		score: 0,
		scoreReason: "The conversation has just started.",
		bookingSlot: null,
	};
}

export function sanitizeAgentView(candidate, bookingOptions = []) {
	if (!isRecord(candidate) || !STAGES.includes(candidate.stage)) return createInitialView();
	const lead = {};
	for (const field of LEAD_FIELDS) {
		const value = candidate.lead?.[field];
		lead[field] = field === "readiness"
			? (["ready", "considering", "not_ready"].includes(value) ? value : null)
			: cleanText(value, 140);
	}
	let stage = candidate.stage;
	const bookingSlot = bookingOptions.includes(candidate.bookingSlot) ? candidate.bookingSlot : null;
	if (stage === "disqualified" && lead.readiness !== "not_ready") stage = "qualifying";
	if (["booking", "booked"].includes(stage) && !isQualified(lead)) stage = "qualifying";
	if (stage === "booked" && !bookingSlot) stage = "booking";
	return {
		stage,
		lead,
		score: Number.isInteger(candidate.score) ? Math.min(100, Math.max(0, candidate.score)) : 0,
		scoreReason: cleanText(candidate.scoreReason, 180) || "No score reason available yet.",
		bookingSlot: stage === "booked" ? bookingSlot : null,
	};
}

export function isQualified(lead) {
	return LEAD_FIELDS.every((field) => Boolean(lead?.[field])) && lead.readiness === "ready";
}

export function validateAgentOutput(candidate, previousView, bookingOptions = []) {
	const parsed = parseCandidate(candidate);
	if (!parsed || typeof parsed.reply !== "string" || !parsed.reply.trim()) {
		return { valid: false, reason: "invalid-json" };
	}

	if (!STAGES.includes(parsed.stage) || !isRecord(parsed.lead)) {
		return { valid: false, reason: "invalid-shape" };
	}

	const previous = sanitizeAgentView(previousView, bookingOptions);
	const lead = {};
	for (const field of LEAD_FIELDS) {
		const value = parsed.lead[field] ?? null;
		if (field === "readiness") {
			if (value !== null && typeof value !== "string") {
				return { valid: false, reason: "invalid-readiness" };
			}
			lead[field] = normalizeReadiness(value) ?? previous.lead[field];
			continue;
		}
		if (value !== null && typeof value !== "string") {
			return { valid: false, reason: "invalid-lead-field" };
		}
		lead[field] = cleanText(value, 140) ?? previous.lead[field];
	}

	const priorStage = previous.stage;
	if (!TRANSITIONS[priorStage].includes(parsed.stage)) {
		return { valid: false, reason: "invalid-transition" };
	}
	if (parsed.stage === "booking" && !isQualified(lead)) {
		return recover("not-qualified-to-book", previous, lead, parsed);
	}
	if (parsed.stage === "disqualified" && lead.readiness !== "not_ready") {
		return recover("unsupported-disqualification", previous, lead, parsed);
	}
	if (lead.readiness === "not_ready" && parsed.stage !== "disqualified") {
		return recover("not-ready-must-disqualify", previous, lead, parsed);
	}

	const bookingSlot = parsed.bookingSlot === null ? null : cleanText(parsed.bookingSlot, 100);
	if (parsed.stage === "booked") {
		if (!isQualified(lead) || !bookingOptions.includes(bookingSlot)) {
			return recover("invalid-booking", previous, lead, parsed);
		}
	} else if (bookingSlot !== null) {
		return recover("unexpected-booking", previous, lead, parsed);
	}

	if (!Number.isInteger(parsed.score) || parsed.score < 0 || parsed.score > 100) {
		return recover("invalid-score", previous, lead, parsed);
	}
	if (typeof parsed.scoreReason !== "string" || !parsed.scoreReason.trim()) {
		return recover("invalid-score-reason", previous, lead, parsed);
	}

	return {
		valid: true,
		value: {
			reply: cleanText(parsed.reply, 600),
			view: {
				stage: parsed.stage,
				lead,
				score: scoreForLead(parsed.score, lead),
				scoreReason: cleanText(parsed.scoreReason, 180),
				bookingSlot,
			},
		},
	};
}

export function fallbackTurn(previousView, bookingOptions = []) {
	const previous = isRecord(previousView) ? previousView : createInitialView();
	const lead = Object.fromEntries(
		LEAD_FIELDS.map((field) => [field, cleanText(previous.lead?.[field], 140)]),
	);
	const qualified = isQualified(lead);
	const stage = ["booked", "disqualified"].includes(previous.stage)
		? previous.stage
		: lead.readiness === "not_ready" ? "disqualified" : qualified ? "booking" : "qualifying";
	const bookingReply = bookingOptions.length === 2
		? `That sounds like a strong fit. I can offer ${bookingOptions[0]} or ${bookingOptions[1]}. Which works better for you?`
		: "That sounds like a strong fit. Would you like to look at two call times?";
	const missingQuestions = {
		level: "What does your running routine look like right now?",
		goal: "What distance or event would you like to work toward?",
		deadline: "When are you hoping to take it on?",
		blocker: "What has made running hard to stick with before?",
		timePerWeek: "How much time could you make for running in a usual week?",
		readiness: "Are you ready to invest in coaching now, or still weighing it up?",
	};
	const nextQuestion = LEAD_FIELDS.find((field) => !lead[field]);
	const reply = stage === "booked"
		? "This demo call is already marked as booked."
		: stage === "disqualified" || lead.readiness === "not_ready"
			? "Thanks for being honest. Coaching can wait, so here is Mila's free 3-run week planner instead."
			: qualified
				? bookingReply
				: `I lost my place for a moment. ${missingQuestions[nextQuestion] || "What would help you decide on a next step?"}`;
	return {
		reply,
		view: {
			stage,
			lead,
			score: Number.isInteger(previous.score) ? Math.min(100, Math.max(0, previous.score)) : 0,
			scoreReason: qualified
				? "Clear goal, workable schedule, and ready to invest."
				: "Keeping the last validated details while I recover.",
			bookingSlot: typeof previous.bookingSlot === "string" ? previous.bookingSlot : null,
		},
	};
}

function recover(reason, previous, lead, parsed) {
	if (["booked", "disqualified"].includes(previous.stage)) return { valid: false, reason };
	return {
		valid: false,
		reason,
		recoveredView: {
			stage: lead.readiness === "not_ready" ? "disqualified" : "qualifying",
			lead,
			score: Number.isInteger(parsed.score) && parsed.score >= 0 && parsed.score <= 100
				? scoreForLead(parsed.score, lead)
				: previous.score,
			scoreReason: typeof parsed.scoreReason === "string" && parsed.scoreReason.trim()
				? cleanText(parsed.scoreReason, 180)
				: previous.scoreReason,
			bookingSlot: null,
		},
	};
}

function scoreForLead(modelScore, lead) {
	if (isQualified(lead)) return Math.max(85, modelScore);
	if (lead.readiness === "not_ready") return Math.min(25, modelScore);
	return modelScore;
}

function parseCandidate(candidate) {
	if (typeof candidate === "string") {
		try {
			return JSON.parse(candidate);
		} catch {
			return null;
		}
	}
	if (!isRecord(candidate)) return null;
	if (typeof candidate.response === "string") return parseCandidate(candidate.response);
	if (isRecord(candidate.response)) return candidate.response;
	return candidate;
}

function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value, maxLength) {
	if (typeof value !== "string") return null;
	return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength) || null;
}

function normalizeReadiness(value) {
	if (value === null) return null;
	const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
	if (["ready", "considering", "not_ready"].includes(normalized)) return normalized;
	if (/\bnot ready\b|\bnot looking to invest\b/i.test(value)) return "not_ready";
	if (/\b(?:maybe|considering|unsure|not sure|thinking about it)\b/i.test(value)) return "considering";
	if (/\b(?:ready|yes|absolutely)\b/i.test(value)) return "ready";
	return null;
}