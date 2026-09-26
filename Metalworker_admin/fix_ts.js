const fs = require('fs');

// Fix folders.tsx
let f1 = fs.readFileSync('src/app/folders.tsx', 'utf-8');
f1 = f1.replace(/const TYPE_BADGES: Record<FolderItemType, \{ label: string; color: string \}> = \{[\s\S]*?\};/, `const getTypeBadges = (theme: AppTheme): Record<FolderItemType, { label: string; color: string }> => ({
  owner_stock: { label: "Owner", color: theme.colors.primary },
  company_stock: { label: "Company", color: "#8B5CF6" },
  bill_group: { label: "Bill", color: theme.colors.warning },
  drawing_group: { label: "Drawing", color: theme.colors.success },
  job: { label: "Job", color: theme.colors.danger },
});`);
f1 = f1.replace(/TYPE_BADGES\[([^\]]+)\]/g, 'getTypeBadges(theme)[$1]');
fs.writeFileSync('src/app/folders.tsx', f1);

// Fix FolderContents.tsx
let f2 = fs.readFileSync('src/components/folders/FolderContents.tsx', 'utf-8');
f2 = f2.replace(/const TYPE_BADGES: Record<FolderItemType, \{ label: string; color: string \}> = \{[\s\S]*?\};/, `const getTypeBadges = (theme: AppTheme): Record<FolderItemType, { label: string; color: string }> => ({
  owner_stock: { label: "Owner", color: theme.colors.primary },
  company_stock: { label: "Company", color: "#8B5CF6" },
  bill_group: { label: "Bill", color: theme.colors.warning },
  drawing_group: { label: "Drawing", color: theme.colors.success },
  job: { label: "Job", color: theme.colors.danger },
});`);
f2 = f2.replace(/TYPE_BADGES\[([^\]]+)\]/g, 'getTypeBadges(theme)[$1]');
fs.writeFileSync('src/components/folders/FolderContents.tsx', f2);

// Fix DragDropProvider.tsx
let f3 = fs.readFileSync('src/components/folders/DragDropProvider.tsx', 'utf-8');
f3 = f3.replace(/const TYPE_COLORS: Record<FolderItemType, string> = \{[\s\S]*?\};/, `const getTypeColors = (theme: AppTheme): Record<FolderItemType, string> => ({
  owner_stock: theme.colors.primary,
  company_stock: "#8B5CF6",
  bill_group: theme.colors.warning,
  drawing_group: theme.colors.success,
  job: theme.colors.danger,
});`);
f3 = f3.replace(/TYPE_COLORS\[([^\]]+)\]/g, 'getTypeColors(theme)[$1]');
fs.writeFileSync('src/components/folders/DragDropProvider.tsx', f3);

// Fix Button.tsx and Input.tsx imports
let filesToFixReactImport = ['src/components/ui/Button.tsx', 'src/components/ui/Input.tsx'];
filesToFixReactImport.forEach(file => {
  let content = fs.readFileSync(file, 'utf-8');
  content = content.replace(/import React, \{\s*/, 'import React, { useMemo } from "react";\nimport {\n  ');
  content = content.replace(/React\.useMemo/g, 'useMemo');
  fs.writeFileSync(file, content);
});

// Fix dashboard.tsx
let d = fs.readFileSync('src/app/dashboard.tsx', 'utf-8');
d = d.replace(/function StatCard\(\{([^}]+)\}: \{([^}]+)\}\) \{/, 'function StatCard({$1}: {$2}) {\n  const { theme } = useTheme();\n  const styles = React.useMemo(() => createStyles(theme), [theme]);');
d = d.replace(/function DispatchRow\(\{([^}]+)\}: \{([^}]+)\}\) \{/, 'function DispatchRow({$1}: {$2}) {\n  const styles = React.useMemo(() => createStyles(theme), [theme]);');
fs.writeFileSync('src/app/dashboard.tsx', d);
