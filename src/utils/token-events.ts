import { EventEmitter } from "events";

export const tokenEventEmitter = new EventEmitter();

export type TokenCountEvent = {
  count: number;
};
