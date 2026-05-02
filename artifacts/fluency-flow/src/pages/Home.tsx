import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useCreateConversation,
  useGetConversation,
  getGetConversationQueryKey,
  useGetVocabulary,
  getGetVocabularyQueryKey,
  useGetSessionSummary,
  getGetSessionSummaryQueryKey,
  useGetFluencyScore,
  getGetFluencyScoreQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Mic, MicOff, Send, BookOpen, X, ChevronLeft, ChevronRight, Zap, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

type Scenario = "general" | "job_interview" | "ordering_coffee" | "startup_pitch";
type InputLang = "english" | "hindi_hinglish";

interface StreamMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  originalInput?: string;
  polishedVersion?: string;
  correction?: string;
  isStreaming?: boolean;
  fluencyScore?: number;
}

const SCENARIOS: { value: Scenario; label: string }[] = [
  { value: "general", label: "General Chat" },
  { value: "job_interview", label: "Job Interview" },
  { value: "ordering_coffee", label: "Ordering Coffee" },
  { value: "startup_pitch", label: "Startup Pitch" },
];

function detectLanguage(text: string): InputLang {
  // Check for Devanagari script or common Hinglish patterns
  const devanagariRegex = /[\u0900-\u097F]/;
  const hinglishWords = ["kya", "hai", "nahi", "aur", "kaise", "mujhe", "mera", "tera", "tum", "hum", "bhi", "abhi", "theek", "accha", "yaar", "bhai", "dost", "matlab", "pata", "nai", "kar", "karo", "main", "hoon"];
  const lowerText = text.toLowerCase();
  if (devanagariRegex.test(text)) return "hindi_hinglish";
  if (hinglishWords.some((w) => lowerText.includes(w))) return "hindi_hinglish";
  return "english";
}

function FluencyArc({ score }: { score: number }) {
  const clampedScore = Math.min(10, Math.max(1, score));
  const percent = (clampedScore - 1) / 9;
  const radius = 40;
  const circumference = Math.PI * radius; // half circle
  const strokeDashoffset = circumference - percent * circumference;
  const color = clampedScore <= 3 ? "#ef4444" : clampedScore <= 6 ? "#f59e0b" : "#22c55e";
  const label = clampedScore <= 3 ? "needs_work" : clampedScore <= 6 ? "stable" : "improving";

  return (
    <div className="flex flex-col items-center">
      <svg width="100" height="56" viewBox="0 0 100 56" overflow="visible">
        <path
          d="M 10 50 A 40 40 0 0 1 90 50"
          fill="none"
          stroke="hsl(240 5% 16%)"
          strokeWidth="8"
          strokeLinecap="round"
        />
        <motion.path
          d="M 10 50 A 40 40 0 0 1 90 50"
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          animate={{ strokeDashoffset, stroke: color }}
          initial={false}
          transition={{ duration: 0.8, ease: "easeInOut" }}
        />
        <motion.text
          x="50"
          y="44"
          textAnchor="middle"
          fill="white"
          fontSize="18"
          fontWeight="bold"
          animate={{ opacity: 1 }}
        >
          {clampedScore.toFixed(1)}
        </motion.text>
      </svg>
      <span className="text-xs text-muted-foreground mt-1">
        {label === "improving" ? "Improving" : label === "stable" ? "Stable" : "Needs Work"}
      </span>
    </div>
  );
}

function VocabCard({ entry, index }: { entry: { word: string; type: string; definition: string; exampleSentence?: string | null }; index: number }) {
  const typeColor: Record<string, string> = {
    word: "bg-primary/20 text-primary",
    idiom: "bg-purple-500/20 text-purple-400",
    phrase: "bg-emerald-500/20 text-emerald-400",
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      className="p-3 bg-card rounded-lg border border-border mb-2"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="font-semibold text-foreground text-sm">{entry.word}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${typeColor[entry.type] || typeColor["word"]}`}>
          {entry.type}
        </span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{entry.definition}</p>
      {entry.exampleSentence && (
        <p className="text-xs text-muted-foreground/70 mt-1 italic">"{entry.exampleSentence}"</p>
      )}
    </motion.div>
  );
}

function ChatBubble({ msg, onSpeak }: { msg: StreamMessage; onSpeak: (text: string) => void }) {
  const isUser = msg.role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}
    >
      <div className={`max-w-[75%] space-y-2`}>
        {!isUser && (
          <div className="flex items-center gap-2 mb-1">
            <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
              <Zap size={12} className="text-white" />
            </div>
            <span className="text-xs text-muted-foreground font-medium">FluencyFlow</span>
          </div>
        )}

        <div
          className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${
            isUser
              ? "bg-primary text-primary-foreground rounded-tr-sm"
              : "bg-card border border-border text-foreground rounded-tl-sm"
          }`}
        >
          {msg.isStreaming ? (
            <span>
              {msg.content}
              <motion.span
                animate={{ opacity: [1, 0] }}
                transition={{ repeat: Infinity, duration: 0.7 }}
                className="inline-block w-0.5 h-4 bg-current ml-0.5 align-middle"
              />
            </span>
          ) : (
            msg.content
          )}
        </div>

        {!isUser && !msg.isStreaming && (
          <button
            onClick={() => onSpeak(msg.content)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors ml-1"
            data-testid={`speak-button-${msg.id}`}
          >
            <Volume2 size={12} />
            <span>Listen</span>
          </button>
        )}

        <AnimatePresence>
          {isUser && msg.polishedVersion && (
            <motion.div
              initial={{ opacity: 0, height: 0, y: -8 }}
              animate={{ opacity: 1, height: "auto", y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="bg-accent/30 border border-primary/30 border-dashed rounded-xl px-4 py-3 space-y-1"
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Zap size={12} className="text-primary" />
                <span className="text-xs font-semibold text-primary">Polished Version</span>
              </div>
              <p className="text-sm text-foreground">{msg.polishedVersion}</p>
              {msg.correction && (
                <p className="text-xs text-muted-foreground mt-1 border-t border-border/50 pt-1">{msg.correction}</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function WelcomeScreen({
  scenario,
  onScenarioChange,
  onStart,
  isLoading,
}: {
  scenario: Scenario;
  onScenarioChange: (s: Scenario) => void;
  onStart: () => void;
  isLoading: boolean;
}) {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="text-center max-w-md w-full space-y-8"
      >
        <div className="space-y-3">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="flex items-center justify-center gap-2 mb-4"
          >
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shadow-lg shadow-primary/30">
              <Zap size={20} className="text-white" />
            </div>
          </motion.div>
          <h1 className="text-5xl font-bold tracking-tighter text-foreground">
            Fluency<span className="text-primary">Flow</span>
          </h1>
          <p className="text-muted-foreground text-base">
            Your personal AI English coach. Type in Hindi or English — we have you covered.
          </p>
        </div>

        <div className="space-y-4">
          <div className="text-left space-y-2">
            <label className="text-sm font-medium text-foreground">Choose your scenario</label>
            <Select value={scenario} onValueChange={(v) => onScenarioChange(v as Scenario)}>
              <SelectTrigger className="w-full bg-card border-border" data-testid="scenario-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCENARIOS.map((s) => (
                  <SelectItem key={s.value} value={s.value} data-testid={`scenario-option-${s.value}`}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            onClick={onStart}
            disabled={isLoading}
            className="w-full h-12 bg-primary hover:bg-primary/90 text-white font-semibold shadow-lg shadow-primary/30 transition-all hover:shadow-primary/50 hover:scale-[1.02]"
            data-testid="start-session-button"
          >
            {isLoading ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full"
              />
            ) : (
              "Start Session"
            )}
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-3 text-center">
          {[
            { label: "Real-time", sub: "corrections" },
            { label: "Voice", sub: "mode" },
            { label: "Vocab", sub: "vault" },
          ].map((f) => (
            <div key={f.label} className="bg-card rounded-lg p-3 border border-border">
              <div className="text-sm font-semibold text-primary">{f.label}</div>
              <div className="text-xs text-muted-foreground">{f.sub}</div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

export default function Home() {
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [selectedScenario, setSelectedScenario] = useState<Scenario>("general");
  const [messages, setMessages] = useState<StreamMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(true);
  const [sessionModalOpen, setSessionModalOpen] = useState(false);
  const [currentScore, setCurrentScore] = useState(5);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const queryClient = useQueryClient();

  const createConversation = useCreateConversation();

  const { data: sessionSummary, refetch: fetchSummary } = useGetSessionSummary(
    conversationId ?? 0,
    { query: { enabled: false, queryKey: getGetSessionSummaryQueryKey(conversationId ?? 0) } }
  );

  const { data: vocabularyData } = useGetVocabulary(
    conversationId ?? 0,
    { query: { enabled: !!conversationId, queryKey: getGetVocabularyQueryKey(conversationId ?? 0) } }
  );

  const { data: fluencyData } = useGetFluencyScore(
    conversationId ?? 0,
    { query: { enabled: !!conversationId, queryKey: getGetFluencyScoreQueryKey(conversationId ?? 0) } }
  );

  // Auto-scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Update score from API
  useEffect(() => {
    if (fluencyData?.score) setCurrentScore(fluencyData.score);
  }, [fluencyData]);

  const handleStart = () => {
    createConversation.mutate(
      { data: { scenario: selectedScenario } },
      {
        onSuccess: (data) => {
          setConversationId(data.id);
          setCurrentScore(data.fluencyScore);
        },
      }
    );
  };

  const sendMessage = useCallback(
    async (content: string, lang?: InputLang) => {
      if (!conversationId || !content.trim() || isStreaming) return;

      const inputLanguage = lang ?? detectLanguage(content);
      const userMsgId = `user-${Date.now()}`;
      const asstMsgId = `asst-${Date.now()}`;

      setMessages((prev) => [
        ...prev,
        { id: userMsgId, role: "user", content: content.trim() },
        { id: asstMsgId, role: "assistant", content: "", isStreaming: true },
      ]);
      setInputText("");
      setIsStreaming(true);

      try {
        const response = await fetch(`/api/conversations/${conversationId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: content.trim(), inputLanguage }),
        });

        if (!response.ok || !response.body) throw new Error("Stream failed");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamedContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const parsed = JSON.parse(line.slice(6));
              if (parsed.done) {
                // Final event — update with parsed content
                setMessages((prev) =>
                  prev.map((m) => {
                    if (m.id === asstMsgId) {
                      return {
                        ...m,
                        content: parsed.conversationalContent || streamedContent,
                        isStreaming: false,
                      };
                    }
                    if (m.id === userMsgId) {
                      return {
                        ...m,
                        polishedVersion: parsed.polishedVersion ?? undefined,
                        correction: parsed.correction ?? undefined,
                      };
                    }
                    return m;
                  })
                );
                if (parsed.fluencyScore) setCurrentScore(parsed.fluencyScore);
                // Invalidate vocab and fluency queries
                queryClient.invalidateQueries({ queryKey: getGetVocabularyQueryKey(conversationId) });
                queryClient.invalidateQueries({ queryKey: getGetFluencyScoreQueryKey(conversationId) });
              } else if (parsed.content) {
                streamedContent += parsed.content;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === asstMsgId ? { ...m, content: streamedContent } : m
                  )
                );
              }
            } catch {
              // ignore parse errors
            }
          }
        }
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === asstMsgId
              ? { ...m, content: "Sorry, something went wrong. Please try again.", isStreaming: false }
              : m
          )
        );
      } finally {
        setIsStreaming(false);
      }
    },
    [conversationId, isStreaming, queryClient]
  );

  const handleSend = () => {
    if (inputText.trim()) sendMessage(inputText);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleVoice = () => {
    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: typeof window.SpeechRecognition; webkitSpeechRecognition?: typeof window.SpeechRecognition }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: typeof window.SpeechRecognition }).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Voice recognition is not supported in your browser. Try Chrome.");
      return;
    }

    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognitionRef.current = recognition;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      if (transcript) {
        const lang = detectLanguage(transcript);
        sendMessage(transcript, lang);
      }
    };

    recognition.onend = () => setIsRecording(false);
    recognition.onerror = () => setIsRecording(false);

    recognition.start();
    setIsRecording(true);
  };

  const handleSpeak = (text: string) => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.9;
      utterance.pitch = 1;
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleEndSession = async () => {
    if (!conversationId) return;
    await fetchSummary();
    setSessionModalOpen(true);
  };

  const handlePrint = () => window.print();

  if (!conversationId) {
    return (
      <WelcomeScreen
        scenario={selectedScenario}
        onScenarioChange={setSelectedScenario}
        onStart={handleStart}
        isLoading={createConversation.isPending}
      />
    );
  }

  const vocab = vocabularyData ?? [];
  const scenarioLabel = SCENARIOS.find((s) => s.value === selectedScenario)?.label ?? "General Chat";

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Vocabulary Vault Sidebar */}
      <AnimatePresence initial={false}>
        {vaultOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="border-r border-border flex flex-col overflow-hidden hidden md:flex"
            style={{ minWidth: 0 }}
          >
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookOpen size={16} className="text-primary" />
                <h2 className="font-semibold text-sm">Vocabulary Vault</h2>
                {vocab.length > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {vocab.length}
                  </Badge>
                )}
              </div>
              <button
                onClick={() => setVaultOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                data-testid="close-vault"
              >
                <ChevronLeft size={16} />
              </button>
            </div>

            <ScrollArea className="flex-1 p-4">
              {vocab.length === 0 ? (
                <div className="text-center text-muted-foreground text-xs py-8 space-y-2">
                  <BookOpen size={24} className="mx-auto opacity-30" />
                  <p>New words and idioms will appear here as you chat</p>
                </div>
              ) : (
                <div>
                  {vocab.map((entry: { id: number; word: string; type: string; definition: string; exampleSentence?: string | null }, i: number) => (
                    <VocabCard key={entry.id} entry={entry} index={i} />
                  ))}
                </div>
              )}
            </ScrollArea>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="h-14 border-b border-border flex items-center justify-between px-4 gap-4 flex-shrink-0">
          <div className="flex items-center gap-3">
            {!vaultOpen && (
              <button
                onClick={() => setVaultOpen(true)}
                className="text-muted-foreground hover:text-primary transition-colors"
                data-testid="open-vault"
              >
                <ChevronRight size={16} />
              </button>
            )}
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-primary/20 flex items-center justify-center">
                <Zap size={12} className="text-primary" />
              </div>
              <span className="font-semibold text-sm">FluencyFlow</span>
            </div>
            <Separator orientation="vertical" className="h-4" />
            <span className="text-sm text-muted-foreground">{scenarioLabel}</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:block">
              <FluencyArc score={currentScore} />
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleEndSession}
              className="text-xs"
              data-testid="end-session-button"
            >
              End Session
            </Button>
          </div>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 px-4 py-4">
          {messages.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="flex flex-col items-center justify-center h-full py-24 text-center space-y-4"
            >
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Zap size={28} className="text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-foreground">Start your {scenarioLabel} session</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Type in English or Hindi — your AI tutor is ready
                </p>
              </div>
            </motion.div>
          ) : (
            <div className="max-w-2xl mx-auto space-y-1">
              {messages.map((msg) => (
                <ChatBubble key={msg.id} msg={msg} onSpeak={handleSpeak} />
              ))}
              <div ref={chatEndRef} />
            </div>
          )}
        </ScrollArea>

        {/* Input Area */}
        <div className="border-t border-border p-4 flex-shrink-0">
          <div className="max-w-2xl mx-auto">
            <div className="flex gap-2 items-end">
              <div className="flex-1 relative">
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type in English or Hindi (Hinglish ok too)..."
                  disabled={isStreaming}
                  rows={1}
                  className="w-full bg-card border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none placeholder:text-muted-foreground disabled:opacity-50 transition-all"
                  style={{ minHeight: 48, maxHeight: 120 }}
                  data-testid="chat-input"
                  onInput={(e) => {
                    const t = e.currentTarget;
                    t.style.height = "auto";
                    t.style.height = `${Math.min(t.scrollHeight, 120)}px`;
                  }}
                />
              </div>

              <motion.button
                whileTap={{ scale: 0.92 }}
                onClick={handleVoice}
                disabled={isStreaming}
                className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all flex-shrink-0 ${
                  isRecording
                    ? "bg-red-500 shadow-lg shadow-red-500/40 animate-pulse"
                    : "bg-card border border-border hover:border-primary/50 hover:text-primary"
                } text-foreground`}
                data-testid="voice-button"
              >
                {isRecording ? <MicOff size={18} className="text-white" /> : <Mic size={18} />}
              </motion.button>

              <motion.button
                whileTap={{ scale: 0.92 }}
                onClick={handleSend}
                disabled={!inputText.trim() || isStreaming}
                className="w-11 h-11 rounded-xl bg-primary hover:bg-primary/90 flex items-center justify-center transition-all disabled:opacity-40 shadow-lg shadow-primary/20 flex-shrink-0"
                data-testid="send-button"
              >
                {isStreaming ? (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                    className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full"
                  />
                ) : (
                  <Send size={16} className="text-white" />
                )}
              </motion.button>
            </div>

            <div className="flex items-center justify-between mt-2 px-1">
              <span className="text-xs text-muted-foreground">
                {isRecording ? "Listening... Click mic to stop" : "Press Enter to send"}
              </span>
              {isStreaming && (
                <span className="text-xs text-primary animate-pulse">AI is thinking...</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Session Summary Modal */}
      <Dialog open={sessionModalOpen} onOpenChange={setSessionModalOpen}>
        <DialogContent className="max-w-lg bg-card border-border max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Session Summary</DialogTitle>
          </DialogHeader>

          <ScrollArea className="flex-1 pr-4">
            {sessionSummary ? (
              <div className="space-y-6 py-2" id="session-summary-print">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-secondary rounded-xl p-4 text-center">
                    <div className="text-2xl font-bold text-foreground">{sessionSummary.totalMessages}</div>
                    <div className="text-xs text-muted-foreground mt-1">Exchanges</div>
                  </div>
                  <div className="bg-secondary rounded-xl p-4 text-center">
                    <div className="text-2xl font-bold text-primary">{sessionSummary.averageFluencyScore?.toFixed(1)}</div>
                    <div className="text-xs text-muted-foreground mt-1">Avg Vibe Score</div>
                  </div>
                </div>

                {sessionSummary.encouragement && (
                  <div className="bg-primary/10 border border-primary/20 rounded-xl p-4">
                    <p className="text-sm text-foreground italic">"{sessionSummary.encouragement}"</p>
                  </div>
                )}

                {sessionSummary.mistakesToAvoid && sessionSummary.mistakesToAvoid.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-3">Mistakes to Avoid</h3>
                    <ul className="space-y-2">
                      {sessionSummary.mistakesToAvoid.map((m: string, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                          <span className="text-red-400 mt-0.5 flex-shrink-0">•</span>
                          {m}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {sessionSummary.newWordsLearned && sessionSummary.newWordsLearned.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-3">
                      New Words Learned ({sessionSummary.newWordsLearned.length})
                    </h3>
                    <div className="space-y-2">
                      {sessionSummary.newWordsLearned.map((entry: { id: number; word: string; type: string; definition: string; exampleSentence?: string | null }, i: number) => (
                        <VocabCard key={entry.id} entry={entry} index={i} />
                      ))}
                    </div>
                  </div>
                )}

                {sessionSummary.topicsDiscussed && sessionSummary.topicsDiscussed.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-foreground mb-2">Topics Discussed</h3>
                    <div className="flex flex-wrap gap-2">
                      {sessionSummary.topicsDiscussed.map((t: string, i: number) => (
                        <Badge key={i} variant="secondary" className="text-xs">{t}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center py-12">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                  className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full"
                />
              </div>
            )}
          </ScrollArea>

          <div className="flex gap-2 pt-4 border-t border-border flex-shrink-0">
            <Button variant="outline" onClick={handlePrint} className="flex-1" data-testid="download-pdf-button">
              Download PDF
            </Button>
            <Button onClick={() => setSessionModalOpen(false)} className="flex-1" data-testid="close-summary-button">
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
