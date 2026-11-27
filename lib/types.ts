import type { ThreadMessageLike } from "@assistant-ui/react";

/** One message in the shape assistant-ui renders. Produced on the server from pi messages. */
export type UiMessage = ThreadMessageLike;

/** Server -> browser events. Sent over SSE. */
export type WireEvent =
	| { type: "sync"; messages: UiMessage[]; running: boolean }
	| { type: "delta"; text: string }
	| { type: "error"; message: string };

export type SessionSummary = {
	id: string;
	title: string;
	cwd: string;
	modified: number;
	running: boolean;
};

export type Config = {
	apiKey: string;
	model: string;
	/** Directories the sidebar offers for new sessions. */
	workspaces: string[];
};
