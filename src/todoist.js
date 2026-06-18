const TODOIST_API_TOKEN = process.env.TODOIST_API_TOKEN
const TODOIST_BASE = 'https://api.todoist.com/rest/v2'

function isEnabled() {
  return !!TODOIST_API_TOKEN
}

async function createTask({ content, due_string, priority = 1 }) {
  if (!isEnabled()) return null
  try {
    const body = { content }
    if (due_string) body.due_string = due_string
    if (priority && priority >= 1 && priority <= 4) body.priority = priority

    const res = await fetch(`${TODOIST_BASE}/tasks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TODOIST_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('TODOIST_ERROR:', res.status, err)
      return null
    }

    const task = await res.json()
    console.log('TODOIST_TASK_CREATED:', task.id, task.content)
    return task
  } catch (e) {
    console.error('TODOIST_FETCH_ERROR:', e.message)
    return null
  }
}

module.exports = { isEnabled, createTask }
