import { defineExtension, section } from "@earendil-works/pi-durable";

export const messaging = defineExtension({
  name: "domos-messaging",
  sections: [
    section(
      "messaging",
      () =>
        "Send updates and final results through native assistant messages. Ask for decisions with the Harness native question tool. Wait for the user's answer before dependent work. Do not repeat an update as the final answer. Keep reasoning in the thinking channel. Use short natural paragraphs unless the user requests a structured document.",
    ),
  ],
});
