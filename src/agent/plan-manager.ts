import { EventEmitter } from 'events';
import { TodoTool } from '../tools';
import { randomUUID } from 'crypto';

interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'high' | 'medium' | 'low';
}

export class PlanManager extends EventEmitter {
  private todos: TodoItem[] = [];
  constructor(private todoTool: TodoTool) {
    super();
    this.todoTool.on('todo_update', async () => {
      const view = await this.todoTool.viewTodoList();
      if (view.success && view.output) {
        this.emit('plan_update', view.output);
      }
    });
  }

  async updateFromMessage(message: string): Promise<void> {
    const lower = message.toLowerCase();
    if (lower.includes('complete') || lower.includes('done')) {
      const todo = this.todos.find((t) => t.status !== 'completed');
      if (todo) {
        todo.status = 'completed';
        await this.todoTool.updateTodoList([{ id: todo.id, status: 'completed' }]);
      }
      return;
    }

    const newTodo: TodoItem = {
      id: randomUUID(),
      content: message,
      status: 'pending',
      priority: 'medium',
    };
    this.todos.push(newTodo);
    await this.todoTool.createTodoList([newTodo]);
  }

  reset(): void {
    this.todos = [];
    this.todoTool.resetTodoList();
  }
}
