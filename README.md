# 🤖 Robotin Control

> A cognitive system for contextualized project knowledge management

[![Bun](https://img.shields.io/badge/Bun-%23000000.svg?style=for-the-badge&logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

## 📖 Overview

**Robotin Control** is a cognitive assistant designed for technical projects (architecture, engineering, software development, etc.) that:

- **Understands and remembers** the unique context of each project
- **Responds with fidelity** to real project knowledge, avoiding hallucinations
- **Connects coherently** notes, transcripts, diagrams, definitions, and decisions
- **Is deterministic**: same inputs produce the same outputs
- **Manages information gaps** with epistemic honesty

## ✨ Features

### Core Capabilities
- 📄 **Document Ingestion**: Process TXT, OpenAPI, and PlantUML files
- 🔍 **Deterministic Query Engine**: Search and synthesize information with source attribution
- 🧠 **Contextual Memory**: Maintain project state across sessions
- 🎯 **Zero Hallucination**: All responses traceable to source documents
- 🔗 **Knowledge Graph**: Connected concepts, decisions, and artifacts

### Interfaces
- 💻 **CLI**: Powerful command-line interface for power users
- 🌐 **Web UI**: Intuitive web interface (Sprint 5)
- 🔌 **API**: RESTful API for integrations

## 🚀 Quick Start

### Prerequisites
- [Bun](https://bun.sh) >= 1.0.26
- [Ollama](https://ollama.ai) (optional, for local LLM)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd robotin-control

# Install dependencies
bun install

# Configure environment
cp .env.example .env.local

# Run in development mode
bun run dev

# Or build and run
bun run build
bun start
```

### CLI Usage

```bash
# Create a new project
bun run dev init "My Project"

# Add documents
bun run dev add ./docs/api.yaml
bun run dev add ./docs/architecture.puml

# Query the knowledge base
bun run dev query "How does the payment system work?"

# Interactive chat mode
bun run dev chat

# List projects
bun run dev project list

# Check status
bun run dev status
```

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     PRESENTATION LAYER                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │     CLI      │  │   Web App    │  │     API      │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
└─────────┼─────────────────┼─────────────────┼──────────────┘
          │                 │                 │
          └─────────────────┼─────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                      CORE SERVICES                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Ingestion  │  │    Query     │  │   Context    │      │
│  │   Service    │  │    Engine    │  │   Manager    │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
└─────────┼─────────────────┼─────────────────┼──────────────┘
          │                 │                 │
          └─────────────────┼─────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                    DATA LAYER                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   LanceDB    │  │    SQLite    │  │    Cache     │      │
│  │   (Vectors)  │  │  (Metadata)  │  │    (Keyv)    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Runtime | [Bun](https://bun.sh) | Fast JavaScript runtime with native TypeScript |
| Vectors | [LanceDB](https://lancedb.github.io/lancedb/) | Embedded vector database for semantic search |
| Metadata | [SQLite](https://www.sqlite.org/) (better-sqlite3) | Relational data with ACID guarantees |
| Embeddings | [Transformers.js](https://huggingface.co/docs/transformers.js) | Local embedding generation |
| LLM | [Ollama](https://ollama.ai) + OpenAI fallback | Local LLM with cloud fallback |
| API | [Elysia](https://elysiajs.com) | High-performance web framework |
| CLI | Custom (Cliffy) | Command-line interface |

## 📁 Project Structure

```
robotin-control/
├── src/
│   ├── cli/                    # Command-line interface
│   │   └── index.ts
│   ├── core/                   # Core business logic
│   │   ├── parser/            # Document parsers (txt, openapi, plantuml)
│   │   ├── embedder/          # Embedding generation
│   │   ├── storage/           # Data persistence layer
│   │   │   ├── metadata.store.ts    # SQLite storage
│   │   │   ├── vector.store.ts      # LanceDB storage
│   │   │   └── storage.service.ts   # Unified storage interface
│   │   ├── query/             # Query engine
│   │   └── context/           # Context management
│   ├── api/                   # REST API (Elysia)
│   ├── models/                # TypeScript type definitions
│   ├── utils/                 # Utility functions
│   └── config/                # Configuration management
├── data/                      # Persistent data storage
├── tests/                     # Test suites
├── memory-bank/               # Project documentation (Spanish)
├── package.json               # Dependencies and scripts
├── tsconfig.json              # TypeScript configuration
└── README.md                  # This file
```

## 🛠️ Development

### Scripts

```bash
# Development with hot reload
bun run dev

# Run tests
bun test

# Type checking
bun run typecheck

# Linting
bun run lint

# Build for production
bun run build

# Start production build
bun start
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ROBOTIN_DATA_DIR` | Data storage directory | `./data` |
| `DATABASE_PATH` | SQLite database path | `./data/robotin.db` |
| `ROBOTIN_LOG_LEVEL` | Log level (trace, debug, info, warn, error) | `info` |
| `OLLAMA_HOST` | Ollama server URL | `http://localhost:11434` |
| `OPENAI_API_KEY` | OpenAI API key (optional) | - |

## 📚 Documentation

- **Architecture**: See `memory-bank/architecture.md` (Spanish)
- **Technical Specs**: See `memory-bank/technical-specs/` (Spanish)
- **Sprint Planning**: See `memory-bank/sprints/` (Spanish)

## 🎯 Roadmap

| Sprint | Focus | Deliverable |
|--------|-------|-------------|
| 1 | Foundation | Storage layer |
| 2 | Ingestion | Document processing pipeline |
| 3 | Query Engine | Deterministic search |
| 4 | Context | Session management |
| 5 | Web UI | Web interface |
| 6 | Polish | Visualization & release |

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- Built with [Bun](https://bun.sh) for blazing fast performance
- Vector search powered by [LanceDB](https://lancedb.github.io/lancedb/)
- Local AI with [Ollama](https://ollama.ai)

---

<p align="center">
  <i>Built with ❤️ for developers who value knowledge</i>
</p>
