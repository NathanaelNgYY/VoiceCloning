import { config } from "@/config";
import { httpClient } from "./httpClient";
import { mockClient } from "./mockClient";
export const api = config.demoMode ? mockClient : httpClient;
