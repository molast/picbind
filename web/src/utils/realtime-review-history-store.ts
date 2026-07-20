"use client";

import {
  loadHistory,
  saveHistory,
} from "@/database/repositories/review-history-repository";

export const loadReviewHistory = loadHistory;
export const saveReviewHistory = saveHistory;
