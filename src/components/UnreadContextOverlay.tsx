import type { RefObject } from "react";
import type { Message } from "@/state/store";

/** Fork preference: suppress the floating "Previous message" unread-context overlay in chat. */
export function UnreadContextOverlay(_props: {
  messages: readonly Message[];
  windowedMessages: readonly Message[];
  unreadMessageId?: string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  visitKey: string;
  onJump: (messageId: string) => void;
}) {
  return null;
}
