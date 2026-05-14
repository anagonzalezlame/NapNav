const fs = require('fs');

let content = fs.readFileSync('App.tsx', 'utf8');

// Replace standard colors with dual colors
content = content.replace(/bg-slate-50\b/g, 'bg-slate-50 dark:bg-slate-900');
content = content.replace(/bg-white\b/g, 'bg-white dark:bg-slate-800');
content = content.replace(/text-slate-900\b/g, 'text-slate-900 dark:text-white');
content = content.replace(/text-slate-800\b/g, 'text-slate-800 dark:text-slate-100');
content = content.replace(/text-slate-700\b/g, 'text-slate-700 dark:text-slate-200');
content = content.replace(/text-slate-600\b/g, 'text-slate-600 dark:text-slate-300');
content = content.replace(/text-slate-500\b/g, 'text-slate-500 dark:text-slate-400');
content = content.replace(/border-slate-100\b/g, 'border-slate-100 dark:border-slate-700');
content = content.replace(/border-slate-200\b/g, 'border-slate-200 dark:border-slate-600');
content = content.replace(/bg-indigo-50\b/g, 'bg-indigo-50 dark:bg-indigo-900\/30');
content = content.replace(/hover:bg-slate-50\b/g, 'hover:bg-slate-50 dark:hover:bg-slate-700');
content = content.replace(/text-indigo-900\b/g, 'text-indigo-900 dark:text-indigo-200');
content = content.replace(/bg-white\b/g, 'bg-white dark:bg-slate-800');

fs.writeFileSync('App.tsx', content);
