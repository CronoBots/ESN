// Regroupement du robot des notifications pour Node (bibliothèques laissées dans node_modules)
export default {
  input: 'scripts/notify-results.ts',
  platform: 'node',
  external: [/^pdfjs-dist/, /^web-push/, /^fflate/],
  output: { file: '.notify-build/notify.mjs', format: 'esm' },
};
