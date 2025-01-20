// src/utils/tasks.ts
import { CloudTasksClient } from "@google-cloud/tasks";

let tasksClient: CloudTasksClient | null = null;

export async function getTasksClient(): Promise<CloudTasksClient> {
  if (!tasksClient) {
    tasksClient = new CloudTasksClient();
  }
  return tasksClient;
}
