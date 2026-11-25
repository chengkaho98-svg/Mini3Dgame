# 可選音樂檔（Optional music）

遊戲所有音效都係即時合成，唔需要任何檔案。音樂就靠呢個資料夾：放入以下檔案就會自動載入，唔使改程式。

| 檔案 | 用途 | 建議 |
|---|---|---|
| `bgm_menu.mp3` | 主選單 | 60–90 秒，**無縫 loop**（結尾接返開頭，唔可以有 fade out） |
| `bgm_race.mp3` | 比賽中 | 90–120 秒，無縫 loop |
| `jingle_win.mp3` | 勝利 | 4–6 秒，有結尾 |
| `jingle_lose.mp3` | 失敗 | 3–4 秒，有結尾 |

- 格式：MP3，44.1 kHz，立體聲，128–192 kbps。
- 冇檔案嗰陣：遊戲照常運作（勝利／失敗 jingle 會用合成版）。
- 公開發布前請確認音樂嘅授權可以公開使用。

All sound effects are synthesised at run time, so nothing here is required.
Drop these four MP3 files in and they are picked up automatically; without
them the game simply plays without music (win/lose jingles fall back to the
synthesised ones).
