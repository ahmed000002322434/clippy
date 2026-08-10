import { query } from "./_generated/server";

/**
 * Reports which AI provider keys are configured on the deployment.
 * Used by the UI to show real integration state (never faked).
 */
export const aiStatus = query({
  args: {},
  handler: async () => {
    return {
      transcriptionConfigured: Boolean(process.env.DEEPGRAM_API_KEY),
      llmConfigured: Boolean(process.env.OPENAI_API_KEY),
    };
  },
});
