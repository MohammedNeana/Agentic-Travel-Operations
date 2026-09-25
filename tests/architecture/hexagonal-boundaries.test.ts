import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function getTsFilesRecursively(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getTsFilesRecursively(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

function extractImportPaths(fileContent: string): string[] {
  const importRegex = /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g;
  const matches: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = importRegex.exec(fileContent)) !== null) {
    matches.push(match[1]);
  }

  return matches;
}

describe('Hexagonal Architecture Boundary Enforcement', () => {
  it('guarantees that Domain layer has zero dependencies on Supabase, Next.js, AI SDKs, or infrastructure adapters', () => {
    const domainDir = path.resolve(process.cwd(), 'src/lib/domain');
    const domainFiles = getTsFilesRecursively(domainDir);
    expect(domainFiles.length).toBeGreaterThan(0);

    const forbiddenPatterns = [
      '@supabase/',
      '@/lib/supabase',
      'next',
      'groq-sdk',
      '@/lib/adapters',
      '@/lib/agent/audit-log',
    ];

    const violations: string[] = [];

    for (const filePath of domainFiles) {
      const content = fs.readFileSync(filePath, 'utf8');
      const imports = extractImportPaths(content);

      for (const imp of imports) {
        for (const pattern of forbiddenPatterns) {
          if (imp === pattern || imp.startsWith(`${pattern}/`)) {
            const relPath = path.relative(process.cwd(), filePath);
            violations.push(`${relPath} imports forbidden infrastructure: "${imp}"`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('guarantees that Application layer has zero dependencies on Supabase, Next.js, AI SDKs, or infrastructure adapters', () => {
    const appDir = path.resolve(process.cwd(), 'src/lib/application');
    const appFiles = getTsFilesRecursively(appDir);
    expect(appFiles.length).toBeGreaterThan(0);

    const forbiddenPatterns = [
      '@supabase/',
      '@/lib/supabase',
      'next',
      'groq-sdk',
      '@/lib/adapters',
      '@/lib/agent/audit-log',
    ];

    const violations: string[] = [];

    for (const filePath of appFiles) {
      const content = fs.readFileSync(filePath, 'utf8');
      const imports = extractImportPaths(content);

      for (const imp of imports) {
        for (const pattern of forbiddenPatterns) {
          if (imp === pattern || imp.startsWith(`${pattern}/`)) {
            const relPath = path.relative(process.cwd(), filePath);
            violations.push(`${relPath} imports forbidden infrastructure: "${imp}"`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('guarantees that Observability layer has zero transitive leaks into Supabase or database storage', () => {
    const obsDir = path.resolve(process.cwd(), 'src/lib/observability');
    const obsFiles = getTsFilesRecursively(obsDir);
    expect(obsFiles.length).toBeGreaterThan(0);

    const forbiddenPatterns = [
      '@supabase/',
      '@/lib/supabase',
      '@/lib/agent/audit-log',
    ];

    const violations: string[] = [];

    for (const filePath of obsFiles) {
      const content = fs.readFileSync(filePath, 'utf8');
      const imports = extractImportPaths(content);

      for (const imp of imports) {
        for (const pattern of forbiddenPatterns) {
          if (imp === pattern || imp.startsWith(`${pattern}/`)) {
            const relPath = path.relative(process.cwd(), filePath);
            violations.push(`${relPath} imports forbidden infrastructure: "${imp}"`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
