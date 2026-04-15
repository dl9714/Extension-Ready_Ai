var STEERING_UI_STYLE_TEMPLATE_A = `
    <style>
      :host { all: initial; }
      .dock {
        display: flex;
        flex-direction: column-reverse;
        align-items: flex-end;
        gap: 10px;
        font-family: Arial, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
        color: #e5e7eb;
      }
      .launcher-row {
        display: inline-flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        width: min(400px, calc(100vw - 28px));
      }
      .dock[data-theme="light"] {
        color: #0f172a;
      }
      .launcher {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border: 1px solid rgba(148, 163, 184, 0.22);
        background: rgba(17, 24, 39, 0.94);
        color: #f8fafc;
        box-shadow: 0 14px 34px rgba(15, 23, 42, 0.35);
        border-radius: 999px;
        padding: 10px 14px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        max-width: min(340px, calc(100vw - 28px));
      }
      .launcher .dot {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: #22c55e;
        box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.14);
        flex: 0 0 auto;
      }
      .launcher-text {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        min-width: 0;
      }
      .launcher-title-row {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        flex-wrap: nowrap;
      }
      .launcher strong {
        font-size: 12px;
        line-height: 1.25;
      }
      .launcher-count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 22px;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid rgba(148, 163, 184, 0.24);
        background: rgba(15, 23, 42, 0.74);
        color: #e2e8f0;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.01em;
        white-space: nowrap;
        flex: 0 0 auto;
      }
      .launcher small {
        font-size: 11px;
        color: rgba(226, 232, 240, 0.9);
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 260px;
      }
      .dock[data-theme="light"] .launcher {
        background: rgba(255, 255, 255, 0.97);
        color: #111827;
        border-color: rgba(99, 102, 241, 0.18);
        box-shadow: 0 14px 34px rgba(15, 23, 42, 0.14);
      }
      .dock[data-theme="light"] .launcher small {
        color: #475569;
      }
      .dock[data-theme="light"] .launcher-count {
        background: rgba(255, 255, 255, 0.92);
        color: #0f172a;
        border-color: rgba(113, 130, 168, 0.22);
      }
      .card {
        position: relative;
        width: min(400px, calc(100vw - 28px));
        border-radius: 18px;
        border: 1px solid rgba(71, 85, 105, 0.42);
        background: rgba(17, 24, 39, 0.98);
        box-shadow: 0 18px 50px rgba(2, 6, 23, 0.45);
        backdrop-filter: blur(14px);
        padding: 14px;
        color: #e5e7eb;
      }
      .drop-shield {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: inherit;
        border: 1px dashed rgba(129, 140, 248, 0.74);
        background: rgba(15, 23, 42, 0.58);
        box-shadow: inset 0 0 0 3px rgba(99, 102, 241, 0.14);
        color: #e8ecff;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.01em;
        z-index: 8;
      }
      .drop-shield[hidden] {
        display: none;
      }
      .dock[data-theme="light"] .card {
        border-color: rgba(113, 130, 168, 0.22);
        background: rgba(255, 255, 255, 0.98);
        box-shadow: 0 18px 50px rgba(15, 23, 42, 0.2);
        color: #0f172a;
      }
      .dock[data-theme="light"] .drop-shield {
        background: rgba(255, 255, 255, 0.72);
        color: #312e81;
      }
      .top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
      }
      .top-main {
        flex: 1 1 auto;
        min-width: 0;
      }
      .title-row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        min-width: 0;
      }
      .title {
        font-size: 13px;
        font-weight: 800;
        line-height: 1.35;
        margin: 0;
      }
      .meta {
        font-size: 11px;
        line-height: 1.4;
        color: #94a3b8;
        white-space: nowrap;
      }
      .dock[data-theme="light"] .meta {
        color: #64748b;
      }
      .icon-btn {
        border: 0;
        background: transparent;
        color: #94a3b8;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
        padding: 2px 4px;
      }
      .input {
        width: 100%;
        min-height: 72px;
        resize: vertical;
        border: 1px solid rgba(148, 163, 184, 0.35);
        border-radius: 14px;
        padding: 10px 12px;
        font-size: 12px;
        line-height: 1.5;
        outline: none;
        background: rgba(2, 6, 23, 0.36);
        color: #f8fafc;
        margin-top: 10px;
      }
      .dock[data-theme="light"] .input {
        background: rgba(248, 250, 252, 0.95);
        color: #111827;
      }
      .input:focus {
        border-color: rgba(99, 102, 241, 0.5);
        box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
      }
      .actions {
        display: flex;
        gap: 6px;
        margin-top: 8px;
      }
      .btn {
        width: auto;
        flex: 1 1 0;
        min-height: 30px;
        border-radius: 10px;
        border: 1px solid rgba(99, 102, 241, 0.34);
        background: linear-gradient(180deg, rgba(99,102,241,0.24), rgba(99,102,241,0.12));
        padding: 6px 8px;
        font-size: 11px;
        line-height: 1.1;
        font-weight: 800;
        white-space: nowrap;
        cursor: pointer;
        color: #eef2ff;
      }
      .dock[data-theme="light"] .btn {
        background: linear-gradient(180deg, rgba(99,102,241,0.14), rgba(99,102,241,0.05));
        color: #312e81;
      }
      .btn[disabled] {
        opacity: 0.55;
        cursor: default;
      }
      .btn.secondary {
        width: auto;
        flex: 1 1 0;
        border-color: rgba(148, 163, 184, 0.28);
        background: rgba(255, 255, 255, 0.08);
        color: #e2e8f0;
      }
      .btn.subtle {
        width: auto;
        flex: 1 1 0;
        border-color: rgba(148, 163, 184, 0.18);
        background: transparent;
        color: #cbd5e1;
      }
      .dock[data-theme="light"] .btn.secondary {
        background: rgba(248, 250, 252, 0.92);
        color: #334155;
      }
      .dock[data-theme="light"] .btn.subtle {
        color: #64748b;
      }
      .queue-wrap {
        display: none;
        flex-direction: column;
        width: min(400px, calc(100vw - 28px));
        max-height: min(260px, 42vh);
        border-radius: 16px;
        border: 1px solid rgba(71, 85, 105, 0.28);
        background: rgba(15, 23, 42, 0.94);
        box-shadow: 0 16px 36px rgba(2, 6, 23, 0.34);
        padding: 10px 12px;
        overflow: hidden;
      }
      .dock[data-theme="light"] .queue-wrap {
        border-color: rgba(113, 130, 168, 0.22);
        background: rgba(255, 255, 255, 0.98);
        box-shadow: 0 16px 36px rgba(15, 23, 42, 0.12);
      }
      .queue-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 6px;
      }
      .queue-head-actions {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }
      .queue-head-btn {
        border: 1px solid rgba(148, 163, 184, 0.2);
        background: rgba(255, 255, 255, 0.04);
        color: #cbd5e1;
        border-radius: 999px;
        padding: 4px 8px;
        font-size: 10px;
        font-weight: 700;
        cursor: pointer;
      }
      .queue-head-btn.danger {
        color: #fca5a5;
      }
      .dock[data-theme="light"] .queue-head-btn {
        background: rgba(248, 250, 252, 0.95);
        color: #475569;
      }
      .queue-label {
        font-size: 10px;
        color: #94a3b8;
        margin-bottom: 6px;
      }
      .dock[data-theme="light"] .queue-label {
        color: #64748b;
      }
      .queue-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        max-height: min(190px, 34vh);
        overflow: auto;
        padding-right: 2px;
      }
      .queue-item {
        display: grid;
        grid-template-columns: 22px minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
        border-radius: 12px;
        border: 1px solid rgba(148, 163, 184, 0.2);
        background: rgba(255, 255, 255, 0.04);
        padding: 8px 10px;
      }
      .queue-item.editing {
        align-items: start;
        border-color: rgba(99, 102, 241, 0.34);
        background: rgba(99, 102, 241, 0.08);
      }
      .dock[data-theme="light"] .queue-item {
        background: rgba(248, 250, 252, 0.95);
      }
      .queue-order {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border-radius: 999px;
        font-size: 10px;
        font-weight: 800;
        background: rgba(34, 197, 94, 0.16);
        color: #bbf7d0;
      }
      .dock[data-theme="light"] .queue-order {
        color: #166534;
      }
      .queue-body {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .queue-text {
        min-width: 0;
        font-size: 11px;
        line-height: 1.4;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        cursor: text;
      }
      .queue-edit-wrap {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .queue-edit-input {
        width: 100%;
        min-width: 0;
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 9px;
        background: rgba(2, 6, 23, 0.32);
        color: #f8fafc;
        padding: 7px 9px;
        font-size: 11px;
        line-height: 1.25;
        outline: none;
      }
      .queue-edit-input:focus {
        border-color: rgba(99, 102, 241, 0.5);
        box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.12);
      }
      .dock[data-theme="light"] .queue-edit-input {
        background: rgba(255, 255, 255, 0.96);
        color: #0f172a;
      }
      .queue-edit-meta {
        font-size: 10px;
        line-height: 1.35;
        color: #94a3b8;
      }
      .queue-actions {
        display: inline-flex;
`;
