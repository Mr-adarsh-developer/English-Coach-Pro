import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { conversations, messages, vocabularyEntries } from "@workspace/db";
import {
  CreateConversationBody,
  GetConversationParams,
  SendMessageParams,
  SendMessageBody,
  GetVocabularyParams,
  GetSessionSummaryParams,
  GetFluencyScoreParams,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";

const router = Router();

// Build scenario system prompt
function buildSystemPrompt(scenario: string): string {
  const scenarioContext: Record<string, string> = {
    general: "This is a general English conversation. Help the user practice everyday English.",
    job_interview: "You are simulating a job interview. Ask professional questions and help the user practice interview English.",
    ordering_coffee: "You are a barista at a coffee shop. Help the user practice ordering food and drinks in English.",
    startup_pitch: "You are an investor. Help the user practice pitching a startup idea in English.",
  };

  return `You are FluencyFlow — a warm, encouraging English language coach. Your role is to help users improve their English communication skills.

SCENARIO: ${scenarioContext[scenario] || scenarioContext["general"]}

CORE RULES (follow ALL of them):
1. TRANSLATION: If the user writes in Hindi, Hinglish, or any mix of Hindi+English, ALWAYS translate their message to natural English first, then respond to the translated meaning.
2. CORRECTION: If the user writes in English with mistakes, show a "Polished Version" with a brief explanation of what was improved.
3. If the user writes correct English, give a short genuine compliment and continue the conversation.
4. ALWAYS keep the conversation going by asking a follow-up question or making a relevant comment.
5. Extract 1-2 new words or idioms from the conversation and mention them naturally.
6. After each response, end with a JSON block (hidden from display) for metadata.

RESPONSE FORMAT:
[Your conversational response here]

---METADATA---
{
  "polishedVersion": "corrected version if needed, null otherwise",
  "correction": "brief explanation of corrections, null if none",
  "newWords": [{"word": "word/phrase", "type": "word|idiom|phrase", "definition": "simple definition", "exampleSentence": "example"}],
  "fluencyScore": 7,
  "wasHindi": false
}

The fluencyScore (1-10) should reflect:
- 1-3: Very basic, short responses, many errors
- 4-6: Intermediate, some errors, reasonable length
- 7-9: Good fluency, complex sentences, few errors  
- 10: Native-like, sophisticated vocabulary, perfect grammar

Do NOT show the ---METADATA--- block in your conversational reply. Keep it at the end.`;
}

// Parse metadata from AI response
function parseAIResponse(raw: string): {
  conversational: string;
  polishedVersion: string | null;
  correction: string | null;
  newWords: Array<{ word: string; type: string; definition: string; exampleSentence?: string }>;
  fluencyScore: number;
} {
  const parts = raw.split("---METADATA---");
  const conversational = parts[0]?.trim() ?? raw;
  let metadata = { polishedVersion: null as string | null, correction: null as string | null, newWords: [] as Array<{ word: string; type: string; definition: string; exampleSentence?: string }>, fluencyScore: 5 };

  if (parts[1]) {
    try {
      const jsonMatch = parts[1].match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        metadata = {
          polishedVersion: parsed.polishedVersion || null,
          correction: parsed.correction || null,
          newWords: parsed.newWords || [],
          fluencyScore: Math.min(10, Math.max(1, parsed.fluencyScore || 5)),
        };
      }
    } catch {
      // ignore parse errors
    }
  }

  return { conversational, ...metadata };
}

// POST /api/conversations
router.post("/conversations", async (req, res) => {
  const body = CreateConversationBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const [conv] = await db
    .insert(conversations)
    .values({ scenario: body.data.scenario, fluencyScore: 5 })
    .returning();

  res.status(201).json({
    id: conv!.id,
    scenario: conv!.scenario,
    createdAt: conv!.createdAt.toISOString(),
    fluencyScore: conv!.fluencyScore,
  });
});

// GET /api/conversations/:id
router.get("/conversations/:id", async (req, res) => {
  const params = GetConversationParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: "Invalid conversation id" });
    return;
  }

  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, params.data.id));

  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conv.id))
    .orderBy(messages.createdAt);

  res.json({
    conversation: {
      id: conv.id,
      scenario: conv.scenario,
      createdAt: conv.createdAt.toISOString(),
      fluencyScore: conv.fluencyScore,
    },
    messages: msgs.map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      role: m.role,
      content: m.content,
      originalInput: m.originalInput,
      polishedVersion: m.polishedVersion,
      correction: m.correction,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

// POST /api/conversations/:id/messages (SSE streaming)
router.post("/conversations/:id/messages", async (req, res) => {
  const params = SendMessageParams.safeParse({ id: req.params.id });
  const body = SendMessageBody.safeParse(req.body);

  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, params.data.id));

  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  // Save user message
  const [userMsg] = await db
    .insert(messages)
    .values({
      conversationId: conv.id,
      role: "user",
      content: body.data.content,
    })
    .returning();

  // Get conversation history
  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conv.id))
    .orderBy(messages.createdAt);

  const chatMessages = [
    { role: "system" as const, content: buildSystemPrompt(conv.scenario) },
    ...history.slice(0, -1).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user" as const, content: body.data.content },
  ];

  // Set up SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let fullResponse = "";

  const stream = await openai.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 8192,
    messages: chatMessages,
    stream: true,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      fullResponse += content;
      res.write(`data: ${JSON.stringify({ content })}\n\n`);
    }
  }

  // Parse the full response
  const parsed = parseAIResponse(fullResponse);

  // Save assistant message
  const [assistantMsg] = await db
    .insert(messages)
    .values({
      conversationId: conv.id,
      role: "assistant",
      content: parsed.conversational,
      polishedVersion: parsed.polishedVersion,
      correction: parsed.correction,
    })
    .returning();

  // Save new words to vocabulary vault
  if (parsed.newWords.length > 0) {
    for (const word of parsed.newWords) {
      await db.insert(vocabularyEntries).values({
        conversationId: conv.id,
        word: word.word,
        type: word.type || "word",
        definition: word.definition,
        exampleSentence: word.exampleSentence,
      });
    }
  }

  // Update conversation fluency score (rolling average)
  const newScore = conv.fluencyScore
    ? (conv.fluencyScore * 0.7 + parsed.fluencyScore * 0.3)
    : parsed.fluencyScore;

  await db
    .update(conversations)
    .set({ fluencyScore: Math.round(newScore * 10) / 10 })
    .where(eq(conversations.id, conv.id));

  res.write(`data: ${JSON.stringify({
    done: true,
    messageId: assistantMsg?.id,
    polishedVersion: parsed.polishedVersion,
    correction: parsed.correction,
    fluencyScore: parsed.fluencyScore,
    conversationalContent: parsed.conversational,
  })}\n\n`);
  res.end();
});

// GET /api/conversations/:id/vocabulary
router.get("/conversations/:id/vocabulary", async (req, res) => {
  const params = GetVocabularyParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: "Invalid conversation id" });
    return;
  }

  const entries = await db
    .select()
    .from(vocabularyEntries)
    .where(eq(vocabularyEntries.conversationId, params.data.id))
    .orderBy(desc(vocabularyEntries.createdAt));

  res.json(entries.map((e) => ({
    id: e.id,
    conversationId: e.conversationId,
    word: e.word,
    type: e.type,
    definition: e.definition,
    exampleSentence: e.exampleSentence,
    createdAt: e.createdAt.toISOString(),
  })));
});

// GET /api/conversations/:id/summary
router.get("/conversations/:id/summary", async (req, res) => {
  const params = GetSessionSummaryParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: "Invalid conversation id" });
    return;
  }

  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, params.data.id));

  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conv.id))
    .orderBy(messages.createdAt);

  const vocab = await db
    .select()
    .from(vocabularyEntries)
    .where(eq(vocabularyEntries.conversationId, conv.id));

  const userMessages = msgs.filter((m) => m.role === "user");
  const corrections = msgs
    .filter((m) => m.role === "assistant" && m.correction)
    .map((m) => m.correction as string);

  // Generate summary using AI
  const summaryPrompt = `Based on this English learning session, generate a session summary.

Scenario: ${conv.scenario}
Number of exchanges: ${userMessages.length}
Average fluency score: ${conv.fluencyScore}/10
Corrections made: ${corrections.join("; ") || "None"}

Return a JSON object with:
{
  "mistakesToAvoid": ["mistake 1", "mistake 2", ...],
  "topicsDiscussed": ["topic 1", ...],
  "encouragement": "a personalized motivational message"
}`;

  let summaryData = {
    mistakesToAvoid: corrections.slice(0, 5),
    topicsDiscussed: [conv.scenario.replace(/_/g, " ")],
    encouragement: "Great practice session! Keep it up!",
  };

  try {
    const summaryResponse = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 1000,
      messages: [{ role: "user", content: summaryPrompt }],
    });
    const content = summaryResponse.choices[0]?.message?.content ?? "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      summaryData = {
        mistakesToAvoid: parsed.mistakesToAvoid || [],
        topicsDiscussed: parsed.topicsDiscussed || [],
        encouragement: parsed.encouragement || summaryData.encouragement,
      };
    }
  } catch {
    // Use defaults
  }

  res.json({
    totalMessages: userMessages.length,
    averageFluencyScore: conv.fluencyScore,
    mistakesToAvoid: summaryData.mistakesToAvoid,
    newWordsLearned: vocab.map((v) => ({
      id: v.id,
      conversationId: v.conversationId,
      word: v.word,
      type: v.type,
      definition: v.definition,
      exampleSentence: v.exampleSentence,
      createdAt: v.createdAt.toISOString(),
    })),
    topicsDiscussed: summaryData.topicsDiscussed,
    encouragement: summaryData.encouragement,
  });
});

// GET /api/conversations/:id/fluency-score
router.get("/conversations/:id/fluency-score", async (req, res) => {
  const params = GetFluencyScoreParams.safeParse({ id: req.params.id });
  if (!params.success) {
    res.status(400).json({ error: "Invalid conversation id" });
    return;
  }

  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, params.data.id));

  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conv.id))
    .orderBy(messages.createdAt);

  // Get recent scores from assistant messages - approximate from fluency score updates
  const recentScores = [conv.fluencyScore];

  res.json({
    score: conv.fluencyScore,
    trend: conv.fluencyScore >= 7 ? "improving" : conv.fluencyScore >= 5 ? "stable" : "needs_work",
    recentScores,
  });
});

export default router;
