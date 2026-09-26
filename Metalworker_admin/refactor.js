const fs = require('fs');
const path = require('path');
const glob = require('glob'); // Not available? We can just do a simple recursive read.

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    const dirPath = path.join(dir, f);
    const isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(dirPath);
  });
}

function processFile(filePath) {
  if (!filePath.endsWith('.tsx') && !filePath.endsWith('.ts')) return;
  if (filePath.includes('theme.ts') || filePath.includes('ThemeContext.tsx') || filePath.includes('_layout.tsx') || filePath.includes('ThemeToggle.tsx')) return;
  
  let content = fs.readFileSync(filePath, 'utf-8');
  
  if (!content.includes('import { theme }')) return;

  // 1. Replace import { theme } from "..."
  // Determine relative path to ThemeContext
  const depth = filePath.split('src')[1].split(path.sep).length - 2;
  const relativePrefix = depth <= 0 ? './' : '../'.repeat(depth);
  
  // Replace the import
  content = content.replace(/import\s+\{\s*theme\s*\}\s+from\s+["'][^"']+theme["'];?/, `import { AppTheme } from "${relativePrefix}constants/theme";\nimport { useTheme } from "${relativePrefix}context/ThemeContext";`);

  // 2. Add useTheme inside main function
  // We need to find the main React component. It's usually `export default function ...` or `export function ...`.
  // If the file exports multiple components, we might need a more sophisticated approach. 
  // Let's do a naive approach for now:
  
  // Find `const styles = StyleSheet.create({`
  if (content.includes('const styles = StyleSheet.create({')) {
    content = content.replace(/const styles = StyleSheet\.create\(\{/g, 'const createStyles = (theme: AppTheme) => StyleSheet.create({');
    
    // Now inject the `useMemo` into the main functional components.
    // We look for `export default function Name(...) {` or `export function Name(...) {`
    const functionRegex = /export\s+(?:default\s+)?function\s+[A-Z][a-zA-Z0-9_]*\s*\([^)]*\)\s*\{/g;
    content = content.replace(functionRegex, (match) => {
      return match + '\n  const { theme } = useTheme();\n  const styles = React.useMemo(() => createStyles(theme), [theme]);\n';
    });
    
    // Some components use `React.useMemo`, so make sure React is imported.
    if (!content.includes('import React')) {
      if (content.includes('import {')) {
        content = content.replace('import {', 'import React, {');
      } else {
        content = "import React from 'react';\n" + content;
      }
    }
  }

  // 3. For files that don't have StyleSheet but use theme (like Button.tsx)
  if (!content.includes('createStyles = (theme: AppTheme)')) {
    const functionRegex = /export\s+(?:default\s+)?function\s+[A-Z][a-zA-Z0-9_]*\s*\([^)]*\)\s*\{/g;
    content = content.replace(functionRegex, (match) => {
      return match + '\n  const { theme } = useTheme();\n';
    });
  }

  fs.writeFileSync(filePath, content, 'utf-8');
  console.log('Processed:', filePath);
}

const root = path.join(__dirname, 'src');
walkDir(root, processFile);
