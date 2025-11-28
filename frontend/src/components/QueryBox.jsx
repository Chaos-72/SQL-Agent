import { useState } from "react";
import axios from "axios";

export default function QueryBox({ sessionId, onResult }) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const askQuestion = async () => {
    if (!question.trim()) return;

    setLoading(true);
    setError("");

    try {
      const res = await axios.post("http://127.0.0.1:8000/ask", {
        session_id: sessionId,
        question,
      });
      onResult(res.data);
    } catch (err) {
      setError(err.response?.data?.detail || "Query failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 bg-white rounded-2xl shadow">
      <h2 className="text-lg font-semibold mb-2">Ask a question</h2>
      <p className="fs-6">Ask questions about your data</p>
      <textarea
        rows={3}
        cols={104}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Ask in natural language (English, Hindi, etc.)"
        className="w-full p-2 border rounded-xl mb-2"
      />
      <div className="text-end">
      <button
        onClick={askQuestion}
        disabled={loading}
        className="px-4 py-2 text-white rounded-xl shadow bg-green-btn"
      >
        {loading ? "Thinking..." : "Ask"}
      </button>
      </div>
      {error && <p className="text-red-500 mt-2">{error}</p>}
    </div>
  );
}
