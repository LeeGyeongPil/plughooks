---
name: hello
description: Greets the user. Use when the user says hello.
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "echo skill-scoped hook"
---

# Hello

Say hello in a friendly way.
