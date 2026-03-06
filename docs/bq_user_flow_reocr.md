# BQ 使用流程與 Re-OCR 回退流程

更新日期: 2026-03-06

## 目標

定義完整使用者流程，並特別覆蓋「任一步回上一步重做 OCR」時的資料一致性要求，避免 BQ Export 出現重複列、殘留舊輸入或錯誤覆寫。

## 流程圖

```mermaid
flowchart TD
    A[Upload PDF] --> B[Draw BQ Boxes / Apply Template]
    B --> C[Run BQ OCR]
    C --> D[Review OCR Rows in BQ Export]
    D --> E[Input Qty/Rate]
    E --> F[Recalculate Total]
    F --> G[Compute Page Total]
    G --> H{Is Collection Page?}
    H -->|No| I[Continue Edit/Review]
    H -->|Yes| J[Map Collection Entry to Referenced Page]
    J --> K[Show Collection Entry Total + Page Total Annotation]
    I --> L[Adjust Printed Text Location]
    K --> L
    L --> M[Export: Annotated PDF / JSON / CSV]
    M --> N[Cloud Save]

    D --> O{OCR Wrong?}
    O -->|Yes| P[Back to BQ OCR]
    P --> Q[Re-run OCR for Selected Page(s)]
    Q --> R[Replace pageKey data in bqPageData]
    R --> S[Clear stale edit state for replaced rows]
    S --> D
    O -->|No| E
```

## 回退/重做 OCR 的預期行為

1. 以 `pageKey = file_id-page_number` 為單位覆蓋該頁 OCR 結果，不可 append。
2. 被重做頁面的舊 `rate/qty/total/user_edited` 需隨 row replacement 一起移除。
3. BQ Export 若當下正在編輯被覆蓋列，應取消編輯，不可把舊輸入寫入新列。
4. 匯出 (PDF/JSON/CSV) 僅使用最新 `bqPageData`。
5. Collection 對頁碼引用配對失敗時，需有 normalize fallback（移除非英數字元）。

## 本次修復摘要

1. Cloud Load 時改為永遠覆蓋 `bqPageData` / `bqTemplates`，避免舊專案資料殘留。
2. BQ Export 加入 row token 檢查：若 row 因 Re-OCR 被替換，立即取消舊編輯狀態。
3. Save edit 前再次驗證 row token；不一致即取消提交，避免誤覆寫新 OCR 行。
4. BQ Export 每列新增 `➕` 動作按鈕，可快速插入下一列；非 collection 頁預設為 `item`，collection 頁預設為 `collection_entry` 或沿用 collection 類型。
5. `page_ocr` 引擎改為在主 BQ 解析中使用 PyMuPDF OCR words 流程，並做重複詞彙去重；若 clip 內已有可用向量文字，優先使用 native text 避免重覆輸出。
6. 新增全域 Busy Mask（全頁遮罩），在 OCR / PDF 匯出 / Cloud Save / Cloud Load 等流程阻止使用者切換模組、再觸發其他操作。

## Engine 備註：Page OCR (PyMuPDF)

1. 目的：處理掃描 PDF（沒有向量文字）。
2. 風險：若 PDF 同時有文字層與影像層，直接 OCR 可能出現重複字串。
3. 策略：
    - clip 區域有 native text 時優先使用 native text。
    - 否則走 OCR words。
    - OCR words 以 `(text, x0, y0, x1, y1)` 近似鍵去重。

## 全域操作鎖定策略

以下操作期間顯示全頁遮罩，禁止其他互動：

1. Upload PDF
2. 通用文字 Recognize
3. BQ OCR（單頁與批次）
4. Export PDF / Export Excel
5. Cloud Save / Cloud Overwrite / Cloud Load

## 測試建議

1. OCR A 頁後輸入 rate，再 Re-OCR A 頁，確認舊 rate/total 不殘留。
2. 編輯中途 Re-OCR 同頁，確認不會把舊編輯內容寫進新 OCR 列。
3. 載入一個無 BQ 資料的雲端專案，確認 BQ Export 為空，不帶前一專案資料。
4. Collection page 引用頁名含特殊字元，確認仍可配對到對應 page total。
