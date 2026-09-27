import { MAX_OUTPUT_TOKENS, MODEL_NAME } from "./config.js";

const ACTIVE_PROVIDER = "workers-ai";

export async function runAgentModel(env, messages, bookingOptions) {
	if (ACTIVE_PROVIDER === "workers-ai") {
		return runWorkersAI(env, messages);
	}
	if (ACTIVE_PROVIDER === "anthropic") {
		return runAnthropicAdapter(messages, bookingOptions);
	}
	throw new Error("Unknown LLM provider.");
}

async function runWorkersAI(env, messages) {
	return env.AI.run(MODEL_NAME, {
		messages,
		max_tokens: MAX_OUTPUT_TOKENS,
		temperature: 0.55,
		response_format: {
			type: "json_schema",
			json_schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					reply: { type: "string", maxLength: 600 },
					stage: {
						type: "string",
						enum: ["opener", "qualifying", "objection", "booking", "booked", "disqualified"],
					},
					lead: {
						type: "object",
						additionalProperties: false,
						properties: {
							level: nullableString,
							goal: nullableString,
							deadline: nullableString,
							blocker: nullableString,
							timePerWeek: nullableString,
							readiness: {
								type: ["string", "null"],
								enum: ["ready", "considering", "not_ready", null],
							},
						},
						required: ["level", "goal", "deadline", "blocker", "timePerWeek", "readiness"],
					},
					score: { type: "integer", minimum: 0, maximum: 100 },
					scoreReason: { type: "string", maxLength: 180 },
					bookingSlot: nullableString,
				},
				required: ["reply", "stage", "lead", "score", "scoreReason", "bookingSlot"],
			},
		},
	});
}

const nullableString = { type: ["string", "null"], maxLength: 140 };

async function runAnthropicAdapter() {
	throw new Error(
		"Anthropic adapter stub: replace this function with an authenticated Messages API fetch and map its text result to the shared JSON contract.",
	);
}