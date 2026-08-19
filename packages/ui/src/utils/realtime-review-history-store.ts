"use client";

import {
  deleteHistory,
  loadHistory,
  saveHistory,
} from "../database/repositories/review-history-repository";

export const deleteReviewHistory = deleteHistory;
export const loadReviewHistory = loadHistory;
export const saveReviewHistory = saveHistory;
