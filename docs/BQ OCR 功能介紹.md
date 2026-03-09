# BQ OCR（工程量表辨識）功能介紹

## 概述

「BQ OCR」模組專為建築及工程行業的 QS（工料測量師）設計，用於從掃描或數位版 BQ（Bill of Quantities）PDF 中，透過 OCR 自動辨識結構化的工程量表資料。使用者在 PDF 上框選欄位區域和資料範圍，系統即可辨識出每行的 Item、Description、Qty、Unit、Rate、Total 等標準欄位。

## 功能

### 框選定義

#### 欄位框選（6 個標準欄位）
- **Item**（項目號）：標記 Item Number 欄的位置
- **Description**（描述）：標記工料描述欄的位置
- **Qty**（數量）
- **Unit**（單位）
- **Rate**（單價）
- **Total**（合計）

以上各欄以不同顏色顯示，框選後按鈕會顯示 ✓ 表示已定義。

#### 區域框選（5 種類型）
- **DataRange**（資料範圍）：**必填**，標記表格內資料行的範圍（不含表頭或備註）
- **Collection**（總結頁標記）：標記此頁為 Collection Sheet
- **PageNo**（頁碼）：標記頁碼位置
- **Revision**（版本號）：標記版本資訊
- **BillName**（Bill 名稱）：標記 Bill 標題

### 模板管理
- 將框選佈局儲存為模板，方便套用到相同格式的其他頁面
- 可更新現有模板
- 勾選「Auto-apply on page change」後，切換頁面時自動套用模板

### OCR 辨識
- **單頁辨識**：點擊「🔍 Extract This Page」辨識當前頁面
- **批量辨識**：點擊「📚 Batch Extract...」一次辨識多頁
- 可選擇不同 OCR 引擎（如 pdfplumber、tesseract），每種引擎顯示每頁配額消耗
- 辨識結果以結構化表格即時顯示

### 辨識結果預覽
- 顯示每行的 ID、Type（item / notes / collection entry）、及各欄位值
- 行類型以顏色區分（綠色 = item、灰色 = notes、藍色 = collection）
- 顯示頁面元資料：頁碼標籤、是否為 Collection 頁、Revision、Bill 名稱

## 使用流程

### 首次設定模板

1. **上傳 PDF**：在工具列上傳 BQ 文件（PDF）
2. **選擇頁面**：在頁面下拉選單中選擇第一頁有資料的頁面
3. **框選欄位**：
   - 點擊 **Item** 按鈕，在 PDF 檢視器上拖曳框選 Item 欄的表頭位置
   - 依序框選 Description、Qty、Unit、Rate、Total
4. **框選 DataRange**：點擊 **DataRange** 按鈕（粗框標記的必填項），框選資料區域
5. **可選區域**：如需要，框選 PageNo、Revision、BillName 等
6. **儲存模板**：輸入模板名稱，點擊「Save as Template」

### 辨識資料

7. **選擇 OCR 引擎**：從引擎下拉選單選擇合適的辨識引擎
8. **單頁辨識**：點擊「🔍 Extract This Page」辨識當前頁面
9. **檢查結果**：在結果表格中檢查辨識是否正確
10. **翻頁套用**：切換到下一頁，系統自動套用模板（若已開啟 Auto-apply）
11. **批量辨識**：確認模板準確後，點擊「📚 Batch Extract...」批量辨識所有頁面

### 結果處理

12. 辨識完成後，切換至「BQ Export」模組進行資料校對和匯出

### 小技巧

- DataRange 框選要盡量精確，避免包含頁首標題或頁尾備註
- 先用單頁辨識測試模板準確度，確認後再批量辨識
- 批量辨識前檢查配額是否足夠（每頁消耗 1 次配額）
- 相同格式的 BQ 文件可共用同一個模板
- Collection 頁面需要標記 Collection 區域，辨識後行類型會自動標記為 collection entry
