import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import fetch from "node-fetch";
import FormData from "form-data";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

app.post("/mcp", async (req, res) => {
  console.log("📩 Received MCP request:", JSON.stringify(req.body, null, 2));
  const { method, params, id, jsonrpc } = req.body;

  try {
    // Handle notifications
    if (id === undefined && method) {
      console.log(`⚙️ Notification: ${method}`);
      return res.status(204).end();
    }

    if (!jsonrpc || !method || id === undefined) {
      return res.status(400).json({
        jsonrpc: "2.0",
        id: id || null,
        error: { code: -32600, message: "Invalid Request" },
      });
    }

    switch (method) {
      case "initialize":
        return res.json({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "Claude → AIArchives Bridge", version: "1.1.0" },
          },
        });

      case "tools/list":
        return res.json({
          jsonrpc: "2.0",
          id,
          result: {
            tools: [
              {
                name: "saveConversation",
                description: "Saves the current Claude chat to AIArchives.",
                inputSchema: {
                  type: "object",
                  properties: {
                    messages: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          role: { type: "string" },
                          content: { type: "string" },
                        },
                        required: ["role", "content"],
                      },
                    },
                  },
                  required: ["messages"],
                },
              },
            ],
          },
        });

      case "tools/call": {
        const { name, arguments: args } = params || {};
        if (name !== "saveConversation") {
          return res.status(400).json({
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Unknown tool: ${name}` },
          });
        }

        const { messages } = args || {};
        if (!Array.isArray(messages)) {
          return res.status(400).json({
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: "Invalid arguments for saveConversation" },
          });
        }

        try {
          // Convert messages to HTML
          const html = messages
            .map((m) => `<p><strong>${m.role}:</strong> ${m.content}</p>`)
            .join("\n");

          // FormData
          const formData = new FormData();
          formData.append("htmlDoc", Buffer.from(html), {
            filename: "conversation.html",
            contentType: "text/html",
          });
          formData.append("isMCP", "true");

          const apiUrl = `${process.env.BASE_URL}/api/conversation`;
          console.log(`➡️ Forwarding conversation to ${apiUrl}`);

          const response = await fetch(apiUrl, {
            method: "POST",
            body: formData,
            headers: formData.getHeaders(),
          });

          if (!response.ok) {
            const text = await response.text();
            throw new Error(`Remote API error: ${response.status} ${response.statusText} - ${text}`);
          }

          const data = await response.json();
          console.log("✅ AIArchives response:", data);

          return res.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                { type: "text", text: `✅ Conversation saved to AIArchives!\n🔗 ${data.url}` },
              ],
              remoteResponse: data,
            },
          });
        } catch (err) {
          console.error("❌ Error calling remote API:", err);
          return res.status(500).json({
            jsonrpc: "2.0",
            id,
            error: { code: -32000, message: err.message },
          });
        }
      }

      default:
        return res.status(400).json({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Unknown method: ${method}` },
        });
    }
  } catch (error) {
    console.error("❌ MCP error:", error);
    return res.status(500).json({
      jsonrpc: "2.0",
      id: id || null,
      error: { code: -32603, message: error.message },
    });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    server: "Claude → AIArchives Bridge",
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 MCP Bridge Server running at http://localhost:${PORT}/mcp`);
});
