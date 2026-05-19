---
layout: grid
pageSize: 20
autoLoad: true
---

```datacorejsx
const activeFile = dc.resolvePath("MARKDOWN EDITOR") || "_RESOURCES/DATACORE/_DONE/MARKDOWN EDITOR/MARKDOWN EDITOR";
const folderPath = activeFile.substring(0, activeFile.lastIndexOf('/'));
const { View } = await dc.require(folderPath + "/src/index.jsx");
return await View({ folderPath, dc });
```
