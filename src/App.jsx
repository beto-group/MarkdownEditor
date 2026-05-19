const { useState, useEffect, useRef } = dc;

// --- Script Loader Utility ---
async function loadScript(dc, src, options = {}) {
  const {
    type = 'script',
    globalName = null,
    cache = true,
    onload = null,
    onerror = null
  } = options;

  // Validate dc context
  if (!dc || !dc.app || !dc.app.vault || !dc.app.vault.adapter) {
    const error = new Error("Datacore context 'dc' with vault adapter is required for loadScript.");
    if (onerror) onerror(error);
    throw error;
  }

  const adapter = dc.app.vault.adapter;
  const cacheDir = ".datacore/script_cache";
  const isUrl = /^https?:\/\//.test(src);

  // Global deduplication check
  if (globalName && window[globalName]) {
    console.log(`[LoadScript] ${globalName} already available (skipping load)`);
    return type === 'module' ? window[globalName] : Promise.resolve();
  }

  // Global promise tracking (prevent duplicate concurrent loads)
  window.__scriptPromises = window.__scriptPromises || {};
  const promiseKey = `${type}:${src}`;
  
  if (window.__scriptPromises[promiseKey]) {
    console.log(`[LoadScript] ${src} already loading, reusing promise...`);
    return window.__scriptPromises[promiseKey];
  }

  console.log(`[LoadScript] Loading ${type} from ${isUrl ? 'URL' : 'local'}: ${src}`);

  // Main loading logic
  const loadPromise = (async () => {
    try {
      let scriptContent = null;

      // Step 1: Fetch or read script content
      if (isUrl) {
        const safeFilename = src
          .replace(/^https?:\/\//, '')
          .replace(/[\/\\?%*:|"<>]/g, '_') + '.js';
        const cachePath = `${cacheDir}/${safeFilename}`;

        // Check cache first
        if (cache && await adapter.exists(cachePath)) {
          console.log(`[LoadScript] Loading from cache: ${cachePath}`);
          try {
            scriptContent = await adapter.read(cachePath);
          } catch (readError) {
            console.warn(`[LoadScript] Cache read failed, refetching:`, readError);
          }
        }

        // Fetch from network if not cached
        if (scriptContent === null) {
          console.log(`[LoadScript] Fetching from network: ${src}`);
          const response = await fetch(src);
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          
          scriptContent = await response.text();

          // Write to cache
          if (cache) {
            try {
              if (!(await adapter.exists(cacheDir))) {
                await adapter.mkdir(cacheDir);
              }
              console.log(`[LoadScript] Caching to: ${cachePath}`);
              await adapter.write(cachePath, scriptContent);
            } catch (writeError) {
              console.warn(`[LoadScript] Cache write failed:`, writeError);
            }
          }
        }
      } else {
        // Local vault path
        console.log(`[LoadScript] Reading from vault: ${src}`);
        if (!(await adapter.exists(src))) {
          throw new Error(`Local file not found: ${src}`);
        }
        scriptContent = await adapter.read(src);
      }

      // Step 2: Execute based on type
      let result;

      if (type === 'module') {
        // ESM MODULE LOADING
        console.log(`[LoadScript] Loading as ESM module...`);
        
        try {
          let moduleExports;
          
          if (isUrl) {
            // For URLs, import directly
            console.log(`[LoadScript] Importing from URL: ${src}`);
            moduleExports = await import(src);
          } else {
            // For local files, create blob URL
            console.log(`[LoadScript] Importing from blob...`);
            const blob = new Blob([scriptContent], { type: 'application/javascript' });
            const blobUrl = URL.createObjectURL(blob);
            
            try {
              moduleExports = await import(blobUrl);
            } finally {
              URL.revokeObjectURL(blobUrl);
            }
          }
          
          console.log(`[LoadScript] Module loaded successfully`);
          
          // Store in global if requested
          if (globalName) {
            window[globalName] = moduleExports;
          }
          
          result = moduleExports;
          
        } catch (importError) {
          throw new Error(`Module import failed: ${importError.message}`);
        }
        
      } else {
        // CLASSIC SCRIPT LOADING
        console.log(`[LoadScript] Loading as classic script...`);
        
        const scriptElement = document.createElement('script');
        scriptElement.type = 'text/javascript';
        
        result = await new Promise((resolve, reject) => {
          scriptElement.textContent = scriptContent;
          
          scriptElement.onerror = (event) => {
            const error = new Error(`Script execution failed: ${src}`);
            console.error(`[LoadScript]`, error);
            if (scriptElement.parentNode) {
              scriptElement.parentNode.removeChild(scriptElement);
            }
            reject(error);
          };
          
          document.body.appendChild(scriptElement);
          
          // Give the script time to execute
          setTimeout(() => {
            console.log(`[LoadScript] Script executed successfully`);
            
            // Check for global if specified
            if (globalName) {
              if (window[globalName]) {
                console.log(`[LoadScript] Global available: window.${globalName}`);
              } else {
                console.warn(`[LoadScript] Global "${globalName}" not found after load`);
              }
            }
            
            resolve(scriptElement);
          }, 100);
        });
      }

      // Success callback
      if (onload) {
        onload(result);
      }

      return result;

    } catch (error) {
      console.error(`[LoadScript] Failed to load ${src}:`, error);
      if (onerror) onerror(error);
      throw error;
      
    } finally {
      // Clean up promise tracker
      delete window.__scriptPromises[promiseKey];
    }
  })();

  // Store promise for deduplication
  window.__scriptPromises[promiseKey] = loadPromise;
  
  return loadPromise;
}

// --- DOM Traversal Utilities ---
function findNearestAncestorWithClass(element, className) {
  if (!element) return null;
  let current = element.parentNode;
  while (current) {
    if (current.classList && current.classList.contains(className)) {
      return current;
    }
    current = current.parentNode;
  }
  return null;
}

function findDirectChildByClass(parent, className) {
  if (!parent) return null;
  for (const child of parent.children) {
    if (child.classList && child.classList.contains(className)) {
      return child;
    }
  }
  return null;
}

// File I/O helpers
async function getRawContent(path) {
  let file = app.vault.getAbstractFileByPath(path);
  if (!file) {
    const name = path.split('/').pop();
    const matches = app.vault.getMarkdownFiles().filter(f => f.name === name);
    if (matches.length > 1) console.warn(`Multiple files found with name ${name}. Using the first match.`);
    file = matches[0];
  }
  if (!file) throw new Error('File not found: ' + path);
  return await app.vault.read(file);
}

async function saveRawContent(path, content) {
  let file = app.vault.getAbstractFileByPath(path);
  if (!file) {
    const name = path.split('/').pop();
    const matches = app.vault.getMarkdownFiles().filter(f => f.name === name);
    if (matches.length > 1) console.warn(`Multiple files found with name ${name}. Using the first match.`);
    file = matches[0];
  }
  if (!file) throw new Error('File not found: ' + path);
  return await app.vault.modify(file, content);
}

function MarkdownEditor({ folderPath, dc }) {
  const instanceId = useRef(Math.random().toString(36).substr(2, 5)).current;
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const previewRef = useRef(null);
  const stateRefs = useRef({}).current;
  
  const [fileName, setFileName] = useState('data/TestFile.md');
  const [saving, setSaving] = useState(false);
  const [rawContent, setRawContent] = useState('');
  const [isDarkMode, setIsDarkMode] = useState(document.body.classList.contains('theme-dark'));
  const [viewMode, setViewMode] = useState('split'); // 'edit', 'split', 'preview'
  const [librariesLoaded, setLibrariesLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [isFullTab, setIsFullTab] = useState(false); // Start false, enable after mount
  
  // Fuzzy search for a file using Fuse.js
  const fuzzyFindFile = dc.useCallback(async (filename) => {
    if (!window.Fuse) {
      console.warn('[MarkdownEditor] Fuse.js not loaded yet');
      return null;
    }

    const allFiles = app.vault.getFiles();
    
    // Try exact path match
    const exactMatch = allFiles.find(f => f.path === filename);
    if (exactMatch) return exactMatch;
    
    // Try exact basename match
    const basenameMatch = allFiles.find(f => f.name === filename || f.basename === filename);
    if (basenameMatch) return basenameMatch;
    
    // Try relative path match
    const relativeMatch = allFiles.find(f => f.path.endsWith(filename));
    if (relativeMatch) return relativeMatch;

    // Fall back to fuzzy search
    const fuse = new window.Fuse(allFiles, {
      keys: [
        { name: 'path', weight: 0.7 },
        { name: 'name', weight: 0.2 },
        { name: 'basename', weight: 0.1 }
      ],
      includeScore: true,
      threshold: 0.4,
    });

    const results = fuse.search(filename);
    if (results.length > 0) {
      return results[0].item;
    }
    
    return null;
  }, []);

  // Get resource path by fuzzy filename match
  const getMediaPath = dc.useCallback(async (filename) => {
    try {
      const file = await fuzzyFindFile(filename);
      if (!file) return null;
      return app.vault.getResourcePath(file);
    } catch (err) {
      console.error(`[MarkdownEditor] Error finding media path for ${filename}:`, err);
      return null;
    }
  }, [fuzzyFindFile]);
  
  const files = dc.useQuery(`@page and $name = "${fileName}"`);

  // Initialize full-tab mode on mount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    
    const targetPaneContent = findNearestAncestorWithClass(
      container,
      "workspace-leaf-content"
    );
    
    if (targetPaneContent) {
      setIsFullTab(true);
    }
  }, []);

  // Full-tab mode effect with styling injection and cleanup
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isFullTab) return;

    const targetPaneContent = findNearestAncestorWithClass(
      container,
      "workspace-leaf-content"
    );
    
    if (!targetPaneContent) {
      setIsFullTab(false);
      return;
    }

    const contentWrapper =
      findDirectChildByClass(targetPaneContent, "view-content") ||
      targetPaneContent;

    stateRefs.originalParent = container.parentNode;
    stateRefs.placeholder = document.createElement("div");
    stateRefs.placeholder.style.display = "none";
    container.parentNode.insertBefore(stateRefs.placeholder, container);

    stateRefs.parentPositionInfo = {
      element: contentWrapper,
      original: window.getComputedStyle(contentWrapper).position,
    };

    if (stateRefs.parentPositionInfo.original === "static") {
      contentWrapper.style.position = "relative";
    }

    contentWrapper.appendChild(container);

    Object.assign(container.style, {
      position: "absolute",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      zIndex: "9998",
      overflow: "auto",
    });

    // Inject stylesheet to hide status-bar and view-footers in FullTab mode
    const styleEl = document.createElement("style");
    styleEl.id = `fulltab-style-hide-${instanceId}`;
    styleEl.textContent = `
      .status-bar, 
      .view-footer, 
      .workspace-leaf-content-footer { 
        display: none !important; 
      }
    `;
    document.head.appendChild(styleEl);

    return () => {
      // Remove injected stylesheet
      const injectedStyle = document.getElementById(`fulltab-style-hide-${instanceId}`);
      if (injectedStyle) injectedStyle.remove();

      if (stateRefs.placeholder?.parentNode) {
        stateRefs.placeholder.parentNode.replaceChild(
          container,
          stateRefs.placeholder
        );
      }
      if (stateRefs.parentPositionInfo?.element) {
        stateRefs.parentPositionInfo.element.style.position =
          stateRefs.parentPositionInfo.original === "static"
            ? ""
            : stateRefs.parentPositionInfo.original;
      }
      container.removeAttribute("style");
      Object.keys(stateRefs).forEach((key) => (stateRefs[key] = null));
    };
  }, [isFullTab]);

  // Load markdown parsing library
  useEffect(() => {
    (async () => {
      try {
        if (window.marked && window.Fuse) {
          setLibrariesLoaded(true);
          return;
        }
        
        // Load Fuse.js for fuzzy file finding
        if (!window.Fuse) {
          await loadScript(dc, 'https://cdn.jsdelivr.net/npm/fuse.js/dist/fuse.js', {
            type: 'script',
            globalName: 'Fuse'
          });
        }
        
        // Load marked from CDN with caching
        if (!window.marked) {
          await loadScript(dc, 'https://cdn.jsdelivr.net/npm/marked@12.0.0/marked.min.js', {
            type: 'script',
            globalName: 'marked'
          });
        }
        
        // Configure marked options
        if (window.marked) {
          const extensions = {
            name: 'callout',
            level: 'block',
            start(src) { return src.match(/^> \[!/)?.index; },
            tokenizer(src, tokens) {
              const rule = /^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|INFO|TODO|SUCCESS|QUESTION|FAILURE|DANGER|BUG|EXAMPLE|QUOTE)\]\s*\n((?:> .*\n?)*)/i;
              const match = rule.exec(src);
              if (match) {
                const type = match[1].toLowerCase();
                const content = match[2].replace(/^> /gm, '').trim();
                return {
                  type: 'callout',
                  raw: match[0],
                  calloutType: type,
                  text: content,
                  tokens: []
                };
              }
            },
            renderer(token) {
              // Standard styling text labels instead of emojis
              const labels = {
                note: 'NOTE', tip: 'TIP', important: 'IMPORTANT', warning: 'WARNING',
                caution: 'CAUTION', info: 'INFO', todo: 'TODO', success: 'SUCCESS',
                question: 'QUESTION', failure: 'FAILURE', danger: 'DANGER', bug: 'BUG',
                example: 'EXAMPLE', quote: 'QUOTE'
              };
              const label = labels[token.calloutType] || 'INFO';
              return `<div class="callout callout-${token.calloutType}">
                <div class="callout-title">${label}</div>
                <div class="callout-content"><p>${token.text}</p></div>
              </div>`;
            }
          };
          
          window.marked.use({ 
            extensions: [extensions],
            breaks: true,
            gfm: true,
            headerIds: true,
            mangle: false,
            sanitize: false, // Allow HTML
            smartLists: true,
            smartypants: true,
            xhtml: false,
            pedantic: false
          });
          
          // Add custom renderer for Obsidian features
          const renderer = new window.marked.Renderer();
          
          // Handle code blocks with copy button
          renderer.code = (code, language, escaped) => {
            const langClass = language ? ` class="language-${language}"` : '';
            const langLabel = language ? `<span class="code-language">${language}</span>` : '';
            const escapedCode = escaped ? code : code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return `<div class="code-block-wrapper">
              <div class="code-block-header">
                ${langLabel}
                <button class="code-copy-btn" data-code="${escapedCode.replace(/"/g, '&quot;')}" title="Copy code">
                  Copy
                </button>
              </div>
              <pre><code${langClass}>${escapedCode}</code></pre>
            </div>`;
          };
          
          // Override paragraph renderer to handle inline features
          const originalParagraph = renderer.paragraph.bind(renderer);
          renderer.paragraph = (text) => {
            // Wikilinks: [[Page]] or [[Page|Display Text]] or [[Page#Section]]
            text = text.replace(/\[\[([^\]|]+?)(?:#([^\]|]+?))?(?:\|([^\]]+))?\]\]/g, (match, link, section, display) => {
              const displayText = display || link;
              const fullLink = section ? `${link}#${section}` : link;
              return `<a href="#" class="internal-link" data-href="${fullLink}" data-link-path="${link}" data-tooltip="${link}">${displayText}</a>`;
            });
            
            // Highlights: ==text==
            text = text.replace(/==(.+?)==/g, '<mark>$1</mark>');
            
            // Tags: #tag
            text = text.replace(/(^|\s)(#[\w\/\-]+)/g, '$1<span class="tag">$2</span>');
            
            return originalParagraph(text);
          };
          
          // Also handle in text renderer for inline contexts
          const originalText = renderer.text.bind(renderer);
          renderer.text = (text) => {
            const vaultPath = app?.vault?.adapter?.basePath || '';
            
            // Obsidian PDF embeds
            text = text.replace(/!\[\[([^\]|]+\.pdf)(?:\|([^\]]+))?\]\]/gi, (match, pdfPath, caption) => {
              const fullPath = `app://local/${vaultPath}/${pdfPath}`;
              return `<div class="pdf-embed">
                <iframe src="${fullPath}" frameborder="0"></iframe>
                ${caption ? `<p class="pdf-caption">${caption}</p>` : ''}
              </div>`;
            });
            
            // Wikilinks in text nodes
            text = text.replace(/\[\[([^\]|]+?)(?:#([^\]|]+?))?(?:\|([^\]]+))?\]\]/g, (match, link, section, display) => {
              const displayText = display || link;
              const fullLink = section ? `${link}#${section}` : link;
              return `<a href="#" class="internal-link" data-href="${fullLink}" data-link-path="${link}" data-tooltip="${link}">${displayText}</a>`;
            });
            
            // Highlights
            text = text.replace(/==(.+?)==/g, '<mark>$1</mark>');
            
            // Tags
            text = text.replace(/(^|\s)(#[\w\/\-]+)/g, '$1<span class="tag">$2</span>');
            
            return originalText(text);
          };
          
          // Handle list items
          const originalListitem = renderer.listitem.bind(renderer);
          renderer.listitem = (text) => {
            const vaultPath = app?.vault?.adapter?.basePath || '';
            
            // Obsidian PDF embeds
            text = text.replace(/!\[\[([^\]|]+\.pdf)(?:\|([^\]]+))?\]\]/gi, (match, pdfPath, caption) => {
              const fullPath = `app://local/${vaultPath}/${pdfPath}`;
              return `<div class="pdf-embed">
                <iframe src="${fullPath}" frameborder="0"></iframe>
                ${caption ? `<p class="pdf-caption">${caption}</p>` : ''}
              </div>`;
            });
            
            // Wikilinks, tags, and highlights
            text = text.replace(/\[\[([^\]|]+?)(?:#([^\]|]+?))?(?:\|([^\]]+))?\]\]/g, (match, link, section, display) => {
              const displayText = display || link;
              const fullLink = section ? `${link}#${section}` : link;
              return `<a href="#" class="internal-link" data-href="${fullLink}" data-link-path="${link}" data-tooltip="${link}">${displayText}</a>`;
            });
            text = text.replace(/==(.+?)==/g, '<mark>$1</mark>');
            text = text.replace(/(^|\s)(#[\w\/\-]+)/g, '$1<span class="tag">$2</span>');
            
            return originalListitem(text);
          };
          
          // Handle standard markdown images
          renderer.image = (href, title, text) => {
            return `<img src="${href}" alt="${text || ''}" title="${title || ''}" class="markdown-image" />`;
          };
          
          window.marked.use({ renderer });
          setLibrariesLoaded(true);
        } else {
          throw new Error('Marked failed to load - window.marked is undefined');
        }
      } catch (err) {
        console.error('[MarkdownEditor] Failed to load libraries:', err);
        setLoadError(err.message);
      }
    })();
  }, []);

  // Load file content
  useEffect(() => {
    (async () => {
      if (files.length) {
        try {
          const md = await getRawContent(files[0].$path);
          setRawContent(md);
        } catch (e) {
          console.error('Failed to load file:', e);
          setRawContent('');
        }
      }
    })();
  }, [files, fileName]);

  // Update preview when content changes
  useEffect(() => {
    if (librariesLoaded && previewRef.current && window.marked) {
      (async () => {
        try {
          let processedContent = rawContent;
          const mathBlocks = [];
          const mathInline = [];
          
          // Extract block math $$...$$
          processedContent = processedContent.replace(/\$\$([\s\S]+?)\$\$/g, (match, math) => {
            mathBlocks.push(math.trim());
            return `\n\n%%%MATH_BLOCK_${mathBlocks.length - 1}%%%\n\n`;
          });
          
          // Extract inline math $...$
          processedContent = processedContent.replace(/(?<!\$)\$(?!\$)([^\$\n]+?)\$(?!\$)/g, (match, math) => {
            mathInline.push(math.trim());
            return `%%%MATH_INLINE_${mathInline.length - 1}%%%`;
          });
          
          // Process images using fuzzy finder (only first occurrence)
          const imageMatches = [...processedContent.matchAll(/!\[\[([^\]|]+\.(png|jpg|jpeg|gif|webp|svg))(?:\|([^\]]+))?\]\]/gi)];
          if (imageMatches.length > 0) {
            const match = imageMatches[0];
            const imagePath = match[1];
            const altText = match[3] || imagePath.split('/').pop().split('.')[0];
            const resourcePath = await getMediaPath(imagePath);
            if (resourcePath) {
              processedContent = processedContent.replace(match[0], `![${altText}](${resourcePath})`);
            } else {
              processedContent = processedContent.replace(match[0], `<div class="image-error">Image not found: ${imagePath}</div>`);
            }
            // Remove other images
            for (let i = 1; i < imageMatches.length; i++) {
              processedContent = processedContent.replace(imageMatches[i][0], '');
            }
          }
          
          // Process PDFs
          const pdfMatches = [...processedContent.matchAll(/!\[\[([^\]|]+\.pdf)(?:\|([^\]]+))?\]\]/gi)];
          for (const match of pdfMatches) {
            const pdfPath = match[1];
            const caption = match[2];
            const resourcePath = await getMediaPath(pdfPath);
            if (resourcePath) {
              const replacement = `<div class="pdf-embed"><iframe src="${resourcePath}" frameborder="0"></iframe>${caption ? `<p class="pdf-caption">${caption}</p>` : ''}</div>`;
              processedContent = processedContent.replace(match[0], replacement);
            } else {
              processedContent = processedContent.replace(match[0], `<div class="pdf-error">PDF not found: ${pdfPath}</div>`);
            }
          }
          
          // Process standard markdown images
          const standardImageMatches = [...processedContent.matchAll(/!\[([^\]]*)\]\(([^)]+\.(png|jpg|jpeg|gif|webp|svg))\)/gi)];
          for (const match of standardImageMatches) {
            const altText = match[1] || 'Image';
            const imagePath = match[2];
            const resourcePath = await getMediaPath(imagePath);
            if (resourcePath) {
              processedContent = processedContent.replace(match[0], `![${altText}](${resourcePath})`);
            } else {
              processedContent = processedContent.replace(match[0], `<div class="image-error">Image not found: ${imagePath}</div>`);
            }
          }
          
          // Parse markdown
          let html = window.marked.parse(processedContent);
        
          // Restore math blocks
          html = html.replace(/<p>%%%MATH_BLOCK_(\d+)%%%<\/p>/g, (match, index) => {
            const math = mathBlocks[parseInt(index)];
            const escapedMath = math.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return `<div class="math-block">${escapedMath}</div>`;
          });
          
          html = html.replace(/%%%MATH_BLOCK_(\d+)%%%/g, (match, index) => {
            const math = mathBlocks[parseInt(index)];
            const escapedMath = math.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return `<div class="math-block">${escapedMath}</div>`;
          });
          
          html = html.replace(/%%%MATH_INLINE_(\d+)%%%/g, (match, index) => {
            const math = mathInline[parseInt(index)];
            const escapedMath = math.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return `<span class="math-inline">${escapedMath}</span>`;
          });
          
          previewRef.current.innerHTML = html;
          
          // Code block copy buttons listener
          const copyButtons = previewRef.current.querySelectorAll('.code-copy-btn');
          copyButtons.forEach((button) => {
            button.addEventListener('click', async (e) => {
              const code = button.getAttribute('data-code')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, '&');
              
              try {
                await navigator.clipboard.writeText(code);
                button.textContent = 'Copied!';
                setTimeout(() => {
                  button.textContent = 'Copy';
                }, 2000);
              } catch (err) {
                console.error('Failed to copy:', err);
                button.textContent = 'Failed';
                setTimeout(() => {
                  button.textContent = 'Copy';
                }, 2000);
              }
            });
          });
          
          // Task list checkbox listeners
          const checkboxes = previewRef.current.querySelectorAll('input[type="checkbox"]');
          checkboxes.forEach((checkbox, index) => {
            checkbox.addEventListener('change', async (e) => {
              e.preventDefault();
              const isChecked = e.target.checked;
              await handleTaskToggle(isChecked, index);
            });
          });
          
          // Wikilink click listeners
          const wikilinks = previewRef.current.querySelectorAll('.internal-link');
          wikilinks.forEach((link) => {
            link.addEventListener('click', (e) => {
              e.preventDefault();
              const targetFile = link.getAttribute('data-href');
              handleWikilinkClick(targetFile);
            });
            
            // Hover preview
            let hoverTimeout;
            let hoverCard;
            
            link.addEventListener('mouseenter', async (e) => {
              const linkPath = link.getAttribute('data-link-path') || link.getAttribute('data-href');
              if (!linkPath) return;
              
              hoverTimeout = setTimeout(async () => {
                try {
                  const filePath = linkPath.split('#')[0];
                  const foundFile = await fuzzyFindFile(filePath);
                  if (!foundFile) return;
                  const content = await getRawContent(foundFile.path);
                  if (!content) return;
                  
                  hoverCard = document.createElement('div');
                  hoverCard.className = 'markdown-hover-preview';
                  hoverCard.style.cssText = `
                    position: fixed;
                    max-width: 400px;
                    max-height: 300px;
                    overflow-y: auto;
                    background: var(--background-primary);
                    border: 1px solid var(--background-modifier-border);
                    border-radius: 8px;
                    padding: 16px;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                    z-index: 100000;
                    font-size: 13px;
                    line-height: 1.6;
                  `;
                  
                  const rect = link.getBoundingClientRect();
                  const spaceBelow = window.innerHeight - rect.bottom;
                  const spaceAbove = rect.top;
                  
                  if (spaceBelow > 300 || spaceBelow > spaceAbove) {
                    hoverCard.style.top = `${rect.bottom + 8}px`;
                  } else {
                    hoverCard.style.bottom = `${window.innerHeight - rect.top + 8}px`;
                  }
                  hoverCard.style.left = `${Math.min(rect.left, window.innerWidth - 420)}px`;
                  
                  const previewLines = content.split('\n').slice(0, 20).join('\n');
                  const previewHtml = window.marked.parse(previewLines);
                  
                  hoverCard.innerHTML = `
                    <div style="font-weight: bold; margin-bottom: 8px; color: var(--text-accent);">
                      ${foundFile.basename || foundFile.name}
                    </div>
                    <div class="markdown-preview-content">
                      ${previewHtml}
                    </div>
                  `;
                  
                  document.body.appendChild(hoverCard);
                } catch (err) {
                  console.error('[MarkdownEditor] Hover preview error:', err);
                }
              }, 300);
            });
            
            link.addEventListener('mouseleave', () => {
              if (hoverTimeout) clearTimeout(hoverTimeout);
              if (hoverCard) hoverCard.remove();
            });
          });
        
        } catch (e) {
          console.error('[MarkdownEditor] Markdown parsing error:', e);
          previewRef.current.innerHTML = `<div style="color: var(--text-error); padding: 20px;">Parse Error: ${e.message}</div>`;
        }
      })();
    }
  }, [rawContent, librariesLoaded, viewMode, getMediaPath]);
  
  // Handle task list checkbox toggle
  const handleTaskToggle = async (checked, index) => {
    if (!files.length) return;
    
    const lines = rawContent.split('\n');
    let taskIndex = 0;
    let modified = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const taskMatch = line.match(/^(\s*[-*+]\s+)\[([ xX])\]/);
      
      if (taskMatch) {
        if (taskIndex === index) {
          const indent = taskMatch[1];
          const newCheckbox = checked ? 'x' : ' ';
          lines[i] = line.replace(/^(\s*[-*+]\s+)\[([ xX])\]/, `${indent}[${newCheckbox}]`);
          modified = true;
          break;
        }
        taskIndex++;
      }
    }
    
    if (modified) {
      const newContent = lines.join('\n');
      setRawContent(newContent);
      
      try {
        await saveRawContent(files[0].$path, newContent);
      } catch (e) {
        console.error('[MarkdownEditor] Failed to save task toggle:', e);
      }
    }
  };
  
  // Handle wikilink click
  const handleWikilinkClick = async (targetFile) => {
    try {
      const parts = targetFile.split('#');
      const filePath = parts[0];
      const sectionAnchor = parts[1] || null;
      
      let file = app.vault.getAbstractFileByPath(filePath);
      
      if (!file) {
        const name = filePath.split('/').pop();
        const matches = app.vault.getMarkdownFiles().filter(f => 
          f.basename === name || f.name === name || f.basename === filePath
        );
        
        if (matches.length > 0) {
          file = matches[0];
        }
      }
      
      if (file) {
        const leaf = app.workspace.getLeaf(false);
        
        if (sectionAnchor) {
          await leaf.openFile(file, { 
            eState: { line: 0, scroll: 0 } 
          });
          
          setTimeout(() => {
            const view = leaf.view;
            if (view && view.editor) {
              const editor = view.editor;
              const content = editor.getValue();
              const lines = content.split('\n');
              const headingPattern = new RegExp(`^#+\\s+.*${sectionAnchor}`, 'i');
              for (let i = 0; i < lines.length; i++) {
                if (headingPattern.test(lines[i])) {
                  editor.setCursor({ line: i, ch: 0 });
                  editor.scrollIntoView({ from: { line: i, ch: 0 }, to: { line: i, ch: 0 } }, true);
                  break;
                }
              }
            }
          }, 100);
        } else {
          await leaf.openFile(file);
        }
      } else {
        new Notice(`File not found: ${filePath}`);
      }
    } catch (error) {
      console.error('[MarkdownEditor] Error opening file:', error);
      new Notice(`Error opening file: ${error.message}`);
    }
  };

  const handleExitFullTab = (e) => {
    e.stopPropagation();
    setIsFullTab(false);
  };

  const handleEnterFullTab = () => setIsFullTab(true);

  const save = async () => {
    if (!files.length) return;
    setSaving(true);
    try {
      await saveRawContent(files[0].$path, rawContent);
    } catch (e) {
      console.error('Save failed:', e);
    }
    setSaving(false);
  };

  const handleEditorInput = (e) => {
    setRawContent(e.target.value);
  };

  const insertMarkdown = (before, after = '') => {
    const textarea = editorRef.current;
    if (!textarea) return;
    
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = rawContent.substring(start, end);
    const newText = rawContent.substring(0, start) + before + selectedText + after + rawContent.substring(end);
    
    setRawContent(newText);
    
    setTimeout(() => {
      textarea.focus();
      const newCursorPos = start + before.length + selectedText.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  // Theme variable bindings for dynamic parity
  const bgColor = isDarkMode ? 'var(--background-primary)' : 'var(--background-primary-alt)';
  const textColor = isDarkMode ? 'var(--text-normal)' : 'var(--text-muted)';
  const borderColor = 'var(--background-modifier-border)';
  const toolbarBg = isDarkMode ? 'var(--background-secondary)' : 'var(--background-secondary-alt)';

  // Compact mode fallback
  if (!isFullTab) {
    return (
      <div ref={containerRef} style={{
        padding: '16px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        border: '1px dashed var(--background-modifier-border)',
        borderRadius: '8px',
        backgroundColor: 'var(--background-primary-alt)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '14px' }}>
          <dc.Icon icon="file-edit" style={{ fontSize: '24px' }} />
          <p style={{ margin: 0 }}>Markdown Editor is in compact mode.</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button 
            style={{
              padding: '8px 16px',
              fontSize: '12px',
              fontWeight: '500',
              color: 'var(--text-on-accent)',
              backgroundColor: 'var(--interactive-accent)',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }} 
            onClick={handleEnterFullTab}
          >
            <dc.Icon icon="maximize-2" style={{ fontSize: '14px' }} />
            Enter Full Tab Mode
          </button>
        </div>
      </div>
    );
  }

  if (!librariesLoaded) {
    return (
      <div style={{ 
        padding: '40px', 
        textAlign: 'center',
        backgroundColor: bgColor,
        color: textColor,
        borderRadius: '8px',
        border: `2px solid ${borderColor}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '20px'
      }}>
        {loadError ? (
          <>
            <dc.Icon icon="alert-circle" style={{ fontSize: '48px', color: 'var(--text-error)' }} />
            <h2>Failed to Load Editor</h2>
            <p style={{ color: 'var(--text-error)' }}>{loadError}</p>
          </>
        ) : (
          <>
            <dc.Icon icon="loader-2" style={{ fontSize: '48px', animation: 'spin 1s linear infinite' }} />
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
            <h2>Loading Markdown Editor...</h2>
            <p style={{ color: 'var(--text-muted)' }}>Fetching libraries from CDN</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div 
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: bgColor,
        borderRadius: '8px',
        border: `2px solid ${borderColor}`,
        overflow: 'hidden',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        height: '100%',
        width: '100%'
      }}
    >
      {/* Obsidian Markdown Styles */}
      <style>{`
        .markdown-preview-view {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        }
        
        .markdown-preview-view h1 {
          font-size: 2em;
          font-weight: 700;
          margin-top: 0.5em;
          margin-bottom: 0.5em;
          border-bottom: 2px solid ${borderColor};
          padding-bottom: 0.3em;
        }
        
        .markdown-preview-view h2 {
          font-size: 1.5em;
          font-weight: 600;
          margin-top: 0.8em;
          margin-bottom: 0.5em;
        }
        
        .markdown-preview-view h3 {
          font-size: 1.25em;
          font-weight: 600;
          margin-top: 0.7em;
          margin-bottom: 0.4em;
        }
        
        .markdown-preview-view code {
          background-color: ${isDarkMode ? 'var(--background-secondary)' : 'var(--background-secondary-alt)'};
          color: var(--text-accent);
          padding: 2px 6px;
          border-radius: 3px;
          font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
          font-size: 0.9em;
        }
        
        .markdown-preview-view pre {
          background-color: ${isDarkMode ? 'var(--background-secondary)' : 'var(--background-secondary-alt)'};
          border: 1px solid ${borderColor};
          border-radius: 6px;
          padding: 16px;
          overflow-x: auto;
          margin: 0;
        }
        
        .markdown-preview-view .code-block-wrapper {
          position: relative;
          margin: 1em 0;
          border-radius: 6px;
          overflow: hidden;
          border: 1px solid ${borderColor};
        }
        
        .markdown-preview-view .code-block-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 12px;
          background-color: var(--background-secondary-alt);
          border-bottom: 1px solid ${borderColor};
        }
        
        .markdown-preview-view .code-language {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
        }
        
        .markdown-preview-view .code-copy-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          background-color: var(--interactive-normal);
          color: var(--text-normal);
          border: 1px solid var(--background-modifier-border);
          border-radius: 4px;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .markdown-preview-view .code-copy-btn:hover {
          background-color: var(--interactive-hover);
        }
        
        .markdown-preview-view .code-block-wrapper pre {
          margin: 0;
          border: none;
          border-radius: 0 0 6px 6px;
        }
        
        .markdown-preview-view pre code {
          background-color: transparent;
          color: ${textColor};
          padding: 0;
        }
        
        .markdown-preview-view blockquote {
          border-left: 4px solid var(--interactive-accent);
          margin: 1em 0;
          padding: 0.5em 1em;
          background-color: var(--background-primary-alt);
          color: var(--text-muted);
        }
        
        .markdown-preview-view table {
          border-collapse: collapse;
          width: 100%;
          margin: 1em 0;
        }
        
        .markdown-preview-view table th,
        .markdown-preview-view table td {
          border: 1px solid ${borderColor};
          padding: 8px 12px;
          text-align: left;
        }
        
        .markdown-preview-view table th {
          background-color: var(--background-primary-alt);
          font-weight: 600;
        }
        
        .markdown-preview-view table tr:nth-child(even) {
          background-color: var(--background-secondary);
        }
        
        .markdown-preview-view mark {
          background-color: var(--text-highlight-bg);
          color: ${textColor};
          padding: 2px 4px;
          border-radius: 2px;
        }
        
        .markdown-preview-view .internal-link {
          color: var(--text-accent);
          text-decoration: none;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          position: relative;
        }
        
        .markdown-preview-view .internal-link:hover {
          text-decoration: underline;
          color: var(--text-accent-hover);
        }
        
        .markdown-hover-preview {
          font-family: var(--font-text, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif);
          color: var(--text-normal);
        }
        
        .markdown-hover-preview .markdown-preview-content h1,
        .markdown-hover-preview .markdown-preview-content h2,
        .markdown-hover-preview .markdown-preview-content h3 {
          margin-top: 8px;
          margin-bottom: 4px;
        }
        
        .markdown-hover-preview .markdown-preview-content p {
          margin: 4px 0;
        }
        
        .markdown-hover-preview .markdown-preview-content code {
          background: var(--background-secondary-alt);
          padding: 2px 4px;
          border-radius: 3px;
          font-size: 12px;
        }
        
        .markdown-preview-view .task-list-checkbox {
          margin-right: 8px;
          cursor: pointer;
          width: 16px;
          height: 16px;
          accent-color: var(--interactive-accent);
        }
        
        .markdown-preview-view ul.contains-task-list {
          list-style-type: none;
          padding-left: 1.5em;
        }
        
        .markdown-preview-view .task-list-item {
          display: flex;
          align-items: flex-start;
          margin: 0.5em 0;
        }
        
        .markdown-preview-view .tag {
          background-color: var(--tag-background);
          color: var(--tag-color);
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 0.85em;
          font-weight: 500;
          white-space: nowrap;
          display: inline-block;
          margin: 0 2px;
          border: 1px solid var(--tag-border);
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .markdown-preview-view .tag:hover {
          background-color: var(--tag-background-hover);
        }
        
        .markdown-preview-view .callout {
          border-left: 4px solid;
          border-radius: 6px;
          padding: 12px 16px;
          margin: 1em 0;
          background-color: var(--background-primary-alt);
        }
        
        .markdown-preview-view .callout-title {
          font-weight: 700;
          margin-bottom: 8px;
          font-size: 0.95em;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        
        .markdown-preview-view .callout-content {
          margin-top: 8px;
        }
        
        .markdown-preview-view .callout-content p:first-child {
          margin-top: 0;
        }
        
        .markdown-preview-view .callout-content p:last-child {
          margin-bottom: 0;
        }
        
        .markdown-preview-view .callout-note {
          border-color: var(--text-accent);
          background-color: var(--background-primary-alt);
        }
        
        .markdown-preview-view .callout-note .callout-title {
          color: var(--text-accent);
        }
        
        .markdown-preview-view .callout-tip {
          border-color: var(--text-success);
          background-color: var(--background-primary-alt);
        }
        
        .markdown-preview-view .callout-tip .callout-title {
          color: var(--text-success);
        }
        
        .markdown-preview-view .callout-important,
        .markdown-preview-view .callout-warning,
        .markdown-preview-view .callout-caution {
          border-color: var(--text-warning);
          background-color: var(--background-primary-alt);
        }
        
        .markdown-preview-view .callout-important .callout-title,
        .markdown-preview-view .callout-warning .callout-title,
        .markdown-preview-view .callout-caution .callout-title {
          color: var(--text-warning);
        }
        
        .markdown-preview-view .callout-danger,
        .markdown-preview-view .callout-failure,
        .markdown-preview-view .callout-bug {
          border-color: var(--text-error);
          background-color: var(--background-primary-alt);
        }
        
        .markdown-preview-view .callout-danger .callout-title,
        .markdown-preview-view .callout-failure .callout-title,
        .markdown-preview-view .callout-bug .callout-title {
          color: var(--text-error);
        }
        
        .markdown-preview-view .callout-info,
        .markdown-preview-view .callout-question {
          border-color: var(--text-accent);
          background-color: var(--background-primary-alt);
        }
        
        .markdown-preview-view .callout-info .callout-title,
        .markdown-preview-view .callout-question .callout-title {
          color: var(--text-accent);
        }
        
        .markdown-preview-view .callout-success,
        .markdown-preview-view .callout-todo {
          border-color: var(--text-success);
          background-color: var(--background-primary-alt);
        }
        
        .markdown-preview-view .callout-success .callout-title,
        .markdown-preview-view .callout-todo .callout-title {
          color: var(--text-success);
        }
        
        .markdown-preview-view .callout-example,
        .markdown-preview-view .callout-quote {
          border-color: var(--text-accent);
          background-color: var(--background-primary-alt);
        }
        
        .markdown-preview-view .callout-example .callout-title,
        .markdown-preview-view .callout-quote .callout-title {
          color: var(--text-accent);
        }
        
        /* Math rendering */
        .markdown-preview-view .math-block {
          display: block;
          margin: 1.5em 0;
          padding: 16px;
          background-color: var(--background-primary-alt);
          border: 1px solid ${borderColor};
          border-radius: 6px;
          overflow-x: auto;
          text-align: center;
          color: var(--text-accent);
          font-family: 'Latin Modern Math', 'STIX Two Math', 'Cambria Math', 'Times New Roman', serif;
          font-size: 1.2em;
          white-space: pre-wrap;
        }
        
        .markdown-preview-view .math-inline {
          display: inline;
          padding: 2px 6px;
          background-color: var(--background-primary-alt);
          color: var(--text-accent);
          font-family: 'Latin Modern Math', 'STIX Two Math', 'Cambria Math', 'Times New Roman', serif;
          font-size: 1em;
          border-radius: 3px;
        }
        
        .markdown-preview-view .footnote-ref {
          color: var(--text-accent);
          font-weight: 600;
          cursor: pointer;
        }
        
        .markdown-preview-view .footnote-ref:hover {
          text-decoration: underline;
        }
        
        .markdown-preview-view .footnotes {
          margin-top: 2em;
          padding-top: 1em;
          border-top: 2px solid ${borderColor};
          font-size: 0.9em;
          color: var(--text-muted);
        }
        
        .markdown-preview-view .footnotes ol {
          padding-left: 1.5em;
        }
        
        .markdown-preview-view .footnotes li {
          margin: 0.5em 0;
        }
        
        .markdown-preview-view .footnotes li p {
          margin: 0;
          display: inline;
        }
        
        .markdown-preview-view hr {
          border: none;
          border-top: 2px solid ${borderColor};
          margin: 2em 0;
        }
        
        .markdown-preview-view ul {
          list-style-type: disc;
          padding-left: 2em;
        }
        
        .markdown-preview-view ol {
          list-style-type: decimal;
          padding-left: 2em;
        }
        
        .markdown-preview-view li {
          margin: 0.5em 0;
        }
        
        .markdown-preview-view li .internal-link {
          color: var(--text-accent);
          text-decoration: none;
          font-weight: 500;
          cursor: pointer;
          display: inline;
        }
        
        .markdown-preview-view li .internal-link:hover {
          text-decoration: underline;
        }
        
        .markdown-preview-view a {
          color: var(--text-accent);
          text-decoration: none;
        }
        
        .markdown-preview-view a:hover {
          text-decoration: underline;
        }
        
        .markdown-preview-view img {
          max-width: 100%;
          height: auto;
          border-radius: 4px;
          margin: 1em 0;
        }
        
        .markdown-preview-view .obsidian-embed {
          display: block;
          max-width: 100%;
          height: auto;
          margin: 1em auto;
          border-radius: 6px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        
        .markdown-preview-view .markdown-image {
          max-width: 100%;
          height: auto;
          border-radius: 4px;
        }
        
        .markdown-preview-view .pdf-embed {
          width: 100%;
          margin: 1.5em 0;
          border: 1px solid ${borderColor};
          border-radius: 6px;
          overflow: hidden;
          background-color: var(--background-primary-alt);
        }
        
        .markdown-preview-view .pdf-embed iframe {
          width: 100%;
          height: 600px;
          border: none;
          display: block;
        }
        
        .markdown-preview-view .pdf-caption {
          text-align: center;
          padding: 8px;
          margin: 0;
          font-size: 0.9em;
          color: var(--text-muted);
          background-color: var(--background-secondary-alt);
          border-top: 1px solid ${borderColor};
        }
        
        .markdown-preview-view .image-error,
        .markdown-preview-view .pdf-error {
          padding: 16px;
          margin: 16px 0;
          border-radius: 8px;
          background-color: var(--background-primary-alt);
          border: 1px solid var(--text-error);
          color: var(--text-error);
          font-family: monospace;
          font-size: 14px;
        }
      `}</style>
      
      {/* Toolbar */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '8px',
        background: toolbarBg, 
        padding: '8px 12px', 
        borderBottom: `1px solid ${borderColor}`,
        flexWrap: 'wrap',
        position: 'relative'
      }}>
        {/* Exit Full Tab Button */}
        <button
          onClick={handleExitFullTab}
          title="Exit Full Tab Mode"
          style={{
            padding: '6px 10px',
            background: 'var(--interactive-normal)',
            color: 'var(--text-normal)',
            border: '1px solid var(--background-modifier-border)',
            borderRadius: '3px',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: '500',
            transition: 'all 0.1s',
            minWidth: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <dc.Icon icon="x" style={{ fontSize: '16px' }} />
        </button>

        {/* File Name Input */}
        <input
          type='text'
          value={fileName}
          onChange={e => setFileName(e.target.value)}
          placeholder='Filename'
          style={{ 
            padding: '6px 10px', 
            borderRadius: '4px', 
            border: `1px solid ${borderColor}`, 
            background: bgColor, 
            color: textColor, 
            fontSize: '13px',
            width: '180px'
          }}
        />

        {/* Markdown Formatting Buttons */}
        <div style={{ display: 'flex', gap: '4px', borderLeft: `1px solid ${borderColor}`, paddingLeft: '8px' }}>
          <button onClick={() => insertMarkdown('**', '**')} title="Bold" style={toolbarButtonStyle}>
            <dc.Icon icon="bold" style={{ fontSize: '14px' }} />
          </button>
          <button onClick={() => insertMarkdown('*', '*')} title="Italic" style={toolbarButtonStyle}>
            <dc.Icon icon="italic" style={{ fontSize: '14px' }} />
          </button>
          <button onClick={() => insertMarkdown('~~', '~~')} title="Strikethrough" style={toolbarButtonStyle}>
            <dc.Icon icon="strikethrough" style={{ fontSize: '14px' }} />
          </button>
          <button onClick={() => insertMarkdown('`', '`')} title="Inline Code" style={toolbarButtonStyle}>
            <dc.Icon icon="code" style={{ fontSize: '14px' }} />
          </button>
          <button onClick={() => insertMarkdown('\n```\n', '\n```\n')} title="Code Block" style={toolbarButtonStyle}>
            <dc.Icon icon="code-2" style={{ fontSize: '14px' }} />
          </button>
          <button onClick={() => insertMarkdown('[](', ')')} title="Link" style={toolbarButtonStyle}>
            <dc.Icon icon="link" style={{ fontSize: '14px' }} />
          </button>
          <button onClick={() => insertMarkdown('- ', '')} title="List" style={toolbarButtonStyle}>
            <dc.Icon icon="list" style={{ fontSize: '14px' }} />
          </button>
          <button onClick={() => insertMarkdown('> ', '')} title="Quote" style={toolbarButtonStyle}>
            <dc.Icon icon="quote" style={{ fontSize: '14px' }} />
          </button>
          <button onClick={() => insertMarkdown('## ', '')} title="Heading" style={toolbarButtonStyle}>
            <dc.Icon icon="heading" style={{ fontSize: '14px' }} />
          </button>
        </div>

        {/* Right side controls */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* View Mode Selector */}
          <select
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value)}
            style={{ 
              padding: '6px 10px', 
              background: bgColor, 
              color: textColor, 
              border: `1px solid ${borderColor}`, 
              borderRadius: '4px', 
              fontSize: '12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <option value="edit">Edit</option>
            <option value="split">Split</option>
            <option value="preview">Preview</option>
          </select>

          {/* Theme Toggle */}
          <button
            onClick={() => setIsDarkMode(prev => !prev)}
            title="Toggle Theme"
            style={toolbarButtonStyle}
          >
            <dc.Icon icon={isDarkMode ? 'moon' : 'sun'} style={{ fontSize: '14px' }} />
          </button>

          {/* Save Button */}
          <button
            onClick={save}
            disabled={saving}
            style={{ 
              padding: '6px 16px', 
              background: 'var(--interactive-accent)', 
              color: 'var(--text-on-accent)', 
              border: 'none', 
              borderRadius: '4px', 
              cursor: saving ? 'wait' : 'pointer',
              fontSize: '13px',
              fontWeight: '500',
              opacity: saving ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <dc.Icon icon={saving ? 'loader-2' : 'save'} style={{ fontSize: '14px' }} />
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Editor & Preview Area */}
      <div style={{ 
        display: 'flex', 
        flex: 1, 
        overflow: 'hidden',
        minHeight: 0
      }}>
        {/* Editor Pane */}
        {(viewMode === 'edit' || viewMode === 'split') && (
          <textarea
            ref={editorRef}
            value={rawContent}
            onChange={handleEditorInput}
            placeholder="# Start writing your markdown here..."
            style={{
              flex: viewMode === 'split' ? 1 : '1 1 100%',
              padding: '16px',
              background: bgColor,
              color: textColor,
              border: 'none',
              borderRight: viewMode === 'split' ? `1px solid ${borderColor}` : 'none',
              resize: 'none',
              fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
              fontSize: '14px',
              lineHeight: '1.6',
              outline: 'none',
              overflow: 'auto'
            }}
            spellCheck={false}
          />
        )}

        {/* Preview Pane */}
        {(viewMode === 'preview' || viewMode === 'split') && (
          <div
            ref={previewRef}
            style={{
              flex: viewMode === 'split' ? 1 : '1 1 100%',
              padding: '16px 20px',
              background: bgColor,
              color: textColor,
              overflow: 'auto',
              fontSize: '15px',
              lineHeight: '1.7'
            }}
            className="markdown-preview-view"
          />
        )}
      </div>

      {/* Status Bar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '6px 12px',
        background: toolbarBg,
        borderTop: `1px solid ${borderColor}`,
        fontSize: '11px',
        color: 'var(--text-muted)',
        gap: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <dc.Icon icon="file-text" style={{ fontSize: '12px' }} />
          <span>{files.length > 0 ? files[0].$path : 'No file selected'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span>{rawContent.length} characters</span>
          <span>•</span>
          <span>{rawContent.split(/\n/).length} lines</span>
          <span>•</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <dc.Icon icon="zap" style={{ fontSize: '12px' }} />
            Powered by Marked.js
          </span>
        </div>
      </div>
    </div>
  );
}

const toolbarButtonStyle = {
  padding: '4px 10px',
  background: 'var(--interactive-normal)',
  color: 'var(--text-normal)',
  border: '1px solid var(--background-modifier-border)',
  borderRadius: '3px',
  cursor: 'pointer',
  fontSize: '12px',
  fontWeight: '500',
  transition: 'all 0.1s',
  minWidth: '32px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center'
};

return { MarkdownEditor };
