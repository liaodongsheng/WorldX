export type XiuxianInteractionContext = {
  kind: "character" | "object";
  targetId: string;
  name: string;
  actionLabel: string;
  interactionId?: string;
};

export type XiuxianGameplayToast = {
  tone: "info" | "success" | "error";
  message: string;
};
