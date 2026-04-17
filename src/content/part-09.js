var STEERING_UI_STYLE_TEMPLATE_B = `
        align-items: center;
        gap: 4px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }
      .queue-action {
        border: 0;
        background: transparent;
        color: #94a3b8;
        cursor: pointer;
        font-size: 13px;
        line-height: 1;
        padding: 0 2px;
      }
      .queue-action.hidden {
        display: none;
      }
      .queue-action.solid,
      .queue-action.muted {
        padding: 5px 7px;
        border-radius: 8px;
        font-size: 10px;
        line-height: 1.1;
        font-weight: 800;
        border: 1px solid rgba(148, 163, 184, 0.24);
      }
      .queue-action.solid {
        background: rgba(99, 102, 241, 0.18);
        color: #eef2ff;
        border-color: rgba(99, 102, 241, 0.32);
      }
      .queue-action.muted {
        background: rgba(148, 163, 184, 0.1);
        color: #e2e8f0;
      }
      .dock[data-theme="light"] .queue-action.muted {
        color: #334155;
      }
      .queue-action.danger {
        color: #fca5a5;
      }
      .title-edit-card {
        margin-top: 10px;
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 14px;
        padding: 10px;
        background: rgba(255, 255, 255, 0.03);
      }
      .dock[data-theme="light"] .title-edit-card {
        background: rgba(248, 250, 252, 0.95);
      }
      .title-edit-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-width: 0;
      }
      .title-edit-label {
        min-width: 0;
        color: #e5e7eb;
        font-size: 11px;
        font-weight: 800;
        line-height: 1.25;
      }
      .dock[data-theme="light"] .title-edit-label {
        color: #0f172a;
      }
      .title-white-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 22px;
        padding: 2px 8px;
        border: 1px solid rgba(148, 163, 184, 0.36);
        border-radius: 999px;
        background: #fff;
        color: #0f172a;
        font-size: 10px;
        font-weight: 800;
        line-height: 1.2;
        white-space: nowrap;
        box-shadow: 0 8px 18px rgba(2, 6, 23, 0.16);
      }
      .dock[data-theme="light"] .title-white-badge {
        border-color: rgba(15, 23, 42, 0.12);
        box-shadow: 0 8px 18px rgba(15, 23, 42, 0.1);
      }
      .title-edit {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto auto;
        gap: 6px;
        align-items: center;
        margin-top: 8px;
      }
      .title-input {
        min-width: 0;
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 10px;
        background: rgba(2, 6, 23, 0.32);
        color: #f8fafc;
        padding: 8px 10px;
        font-size: 11px;
        line-height: 1.2;
        outline: none;
      }
      .title-input:focus {
        border-color: rgba(99, 102, 241, 0.5);
        box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
      }
      .title-btn {
        border: 1px solid rgba(148, 163, 184, 0.24);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.06);
        color: #e2e8f0;
        padding: 8px 10px;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
        white-space: nowrap;
      }
      .title-btn.subtle {
        background: transparent;
        color: #cbd5e1;
      }
      .dock[data-theme="light"] .title-input {
        background: rgba(248, 250, 252, 0.96);
        color: #0f172a;
      }
      .dock[data-theme="light"] .title-btn {
        background: rgba(248, 250, 252, 0.96);
        color: #334155;
      }
      .dock[data-theme="light"] .title-btn.subtle {
        color: #64748b;
      }
      .title-presets {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 8px;
      }
      .title-preset-btn {
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        color: #cbd5e1;
        padding: 5px 9px;
        font-size: 10px;
        font-weight: 700;
        cursor: pointer;
      }
      .dock[data-theme="light"] .title-preset-btn {
        background: rgba(248, 250, 252, 0.96);
        color: #475569;
      }
      .title-meta {
        margin-top: 4px;
        font-size: 10px;
        line-height: 1.35;
        color: #94a3b8;
      }
      .dock[data-theme="light"] .title-meta {
        color: #64748b;
      }
.template-wrap {
  display: none;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 14px;
  padding: 10px;
  background: rgba(255, 255, 255, 0.03);
}
.dock[data-theme="light"] .template-wrap {
  background: rgba(248, 250, 252, 0.95);
}
.template-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.template-label {
  font-size: 11px;
  font-weight: 800;
}
.template-sub {
  font-size: 10px;
  color: #94a3b8;
}
.dock[data-theme="light"] .template-sub {
  color: #64748b;
}
.template-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.template-btn {
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 999px;
  background: rgba(99, 102, 241, 0.12);
  color: #e8ecff;
  padding: 6px 10px;
  font-size: 10px;
  font-weight: 800;
  cursor: pointer;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.template-btn:hover {
  border-color: rgba(129, 140, 248, 0.4);
  background: rgba(99, 102, 241, 0.2);
}
.dock[data-theme="light"] .template-btn {
  background: rgba(99, 102, 241, 0.08);
  color: #3730a3;
}
.status {
        min-height: 16px;
        margin-top: 8px;
        font-size: 11px;
        line-height: 1.4;
        color: #94a3b8;
      }
      .dock[data-theme="light"] .status {
        color: #64748b;
      }
      .status[data-state="error"] {
        color: #f87171;
      }
      .attachment-wrap {
        display: none;
        flex-direction: column;
        gap: 8px;
        margin-top: 10px;
        border: 1px dashed rgba(148, 163, 184, 0.28);
        border-radius: 14px;
        padding: 10px;
        background: rgba(255, 255, 255, 0.03);
      }
      .attachment-wrap.dragging {
        border-color: rgba(99, 102, 241, 0.7);
        background: rgba(99, 102, 241, 0.08);
        box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
      }
      .dock[data-theme="light"] .attachment-wrap {
        background: rgba(248, 250, 252, 0.92);
      }
      .attachment-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .attachment-meta-line {
        font-size: 11px;
        color: #94a3b8;
      }
      .dock[data-theme="light"] .attachment-meta-line {
        color: #64748b;
      }
      .attachment-actions {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .attachment-btn {
        border: 1px solid rgba(148, 163, 184, 0.22);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.05);
        color: #e2e8f0;
        padding: 5px 9px;
        font-size: 10px;
        font-weight: 700;
        cursor: pointer;
      }
      .dock[data-theme="light"] .attachment-btn {
        background: rgba(248, 250, 252, 0.95);
        color: #334155;
      }
      .attachment-btn[disabled] {
        opacity: 0.45;
        cursor: default;
      }
      .attachment-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        max-height: 180px;
        overflow: auto;
      }
      .attachment-item {
        display: grid;
        grid-template-columns: 42px minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
        border-radius: 12px;
        border: 1px solid rgba(148, 163, 184, 0.18);
        background: rgba(255, 255, 255, 0.04);
        padding: 6px;
      }
      .dock[data-theme="light"] .attachment-item {
        background: rgba(255, 255, 255, 0.9);
      }
      .attachment-thumb {
        width: 42px;
        height: 42px;
        border-radius: 10px;
        object-fit: cover;
        background: rgba(15, 23, 42, 0.5);
        color: #cbd5e1;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-weight: 800;
        cursor: pointer;
      }
      .attachment-meta {
        min-width: 0;
      }
      .attachment-name {
        font-size: 11px;
        font-weight: 700;
        line-height: 1.3;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .attachment-sub {
        margin-top: 2px;
        font-size: 10px;
        color: #94a3b8;
      }
      .dock[data-theme="light"] .attachment-sub {
        color: #64748b;
      }
      .attachment-row-actions {
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .attachment-mini-btn,
      .attachment-remove {
        border: none;
        min-width: 26px;
        height: 26px;
        padding: 0 8px;
        border-radius: 999px;
        background: rgba(255,255,255,0.08);
        color: rgba(255,255,255,0.88);
        cursor: pointer;
        font-size: 11px;
        line-height: 1;
      }
      .dock[data-theme="light"] .attachment-mini-btn,
      .dock[data-theme="light"] .attachment-remove {
        background: rgba(241, 245, 249, 0.95);
        color: #334155;
      }
      .attachment-remove {
        color: #fca5a5;
      }
      .attachment-mini-btn[disabled],
      .attachment-remove[disabled] {
        opacity: 0.38;
        cursor: default;
      }
      .attachment-preview {
        position: fixed;
        inset: 0;
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 22px;
        background: rgba(3, 7, 18, 0.78);
      }
      .attachment-preview[hidden] {
        display: none;
      }
      .attachment-preview-card {
        width: min(860px, calc(100vw - 28px));
        max-height: calc(100vh - 28px);
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 16px;
        border-radius: 20px;
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(15, 23, 42, 0.97);
        box-shadow: 0 24px 70px rgba(0,0,0,0.42);
      }
      .attachment-preview-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .attachment-preview-title {
        font-size: 13px;
        font-weight: 800;
        color: #f8fafc;
      }
      .attachment-preview-close,
      .attachment-preview-nav {
        border: none;
        width: 34px;
        height: 34px;
        border-radius: 999px;
        background: rgba(255,255,255,0.1);
        color: rgba(255,255,255,0.92);
        cursor: pointer;
      }
      .attachment-preview-body {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
      }
      .attachment-preview-image {
        max-width: min(760px, calc(100vw - 130px));
        max-height: calc(100vh - 170px);
        border-radius: 18px;
        object-fit: contain;
        background: rgba(255,255,255,0.03);
      }
      .attachment-preview-meta {
        font-size: 12px;
        line-height: 1.45;
        color: rgba(226, 232, 240, 0.78);
        word-break: break-word;
      }
      .file-input {
        display: none;
      }
    </style>
`;
