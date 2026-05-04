import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// Vendored web fonts. Replaces the previous Google Fonts CDN <link> tags
// in index.html so the app makes zero outbound network requests at launch
// (PRD §7.3). Only the weights and styles actually referenced by the
// design system are imported — adding more inflates the bundle.
import '@fontsource/inter/400.css';
import '@fontsource/inter/400-italic.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';

import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('No #root element');
createRoot(root).render(<React.StrictMode><App /></React.StrictMode>);
