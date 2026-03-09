# PDF & Excel 解鎖 功能介紹

## 概述

「PDF & Excel 解鎖」模組允許使用者在瀏覽器中直接移除 PDF 和 Excel（xlsx）檔案的唯讀保護或加密限制，無需安裝任何軟體，也不需要將檔案上傳至後端伺服器。所有處理皆在瀏覽器本機完成，確保檔案隱私。

## 功能

### PDF 解鎖
- 移除 PDF 的文件限制（列印、複製、編輯等限制）
- 使用 **pdf-lib** 函式庫，以 `ignoreEncryption: true` 重新載入並儲存 PDF
- 支援拖拽或點選上傳 PDF 檔案
- 解鎖後自動下載結果檔案

### Excel 解鎖
- 移除 xlsx 工作表保護（sheet protection）
- 使用 **SheetJS (xlsx)** 函式庫，移除每個工作表的 `sheetProtection` 屬性
- 支援拖拽或點選上傳 xlsx 檔案
- 解鎖後自動下載不含保護的 Excel 檔案

## 技術細節

| 項目 | 說明 |
|------|------|
| 處理位置 | 純前端（瀏覽器端） |
| PDF 函式庫 | pdf-lib |
| Excel 函式庫 | SheetJS (xlsx) |
| 檔案大小限制 | 受限於瀏覽器記憶體 |
| 權限控制 | 透過 `pdf_unlock` / `excel_unlock` feature flag 控制 |

## 使用流程

1. 從左側 Activity Bar 選擇「🔓 PDF/Excel 解鎖」模組
2. 選擇 PDF 或 Excel 區塊
3. 上傳需要解鎖的檔案
4. 系統自動處理並下載解鎖後的檔案

## 限制

- 無法破解需要密碼才能開啟的 PDF（user password encryption）
- 僅移除限制型加密（owner password / permissions）
- Excel 僅支援 xlsx 格式，不支援 xls（舊版格式）
