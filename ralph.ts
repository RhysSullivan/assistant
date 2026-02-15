import { $ } from "bun"
import { readFileSync } from "node:fs"
const betterResultMigrationGoal = readFileSync(
    "./executor/better-result-migration.md",
    "utf-8"
)

const STOP_TOKEN = "<I HAVE COMPLETED THE TASK>"

const makePrompt = (goal: string) => `Continue working until you believe the task is complete. As a reminder, the goal is: ${goal}. The above goal was copy pasted in, resume from where you left off. Output ${STOP_TOKEN} when you have completed the task.`

async function run(goal: string, model: "openai/gpt-5.3-codex" | "anthropic/claude-opus-4-6") {
    const prompt = makePrompt(goal)
    let ralph = ''
    while (!ralph.includes(STOP_TOKEN)) {
        const command = $`opencode run --model ${model} --continue ${prompt}`

        ralph = await command.text()
    }
}

await run(betterResultMigrationGoal, "anthropic/claude-opus-4-6")
