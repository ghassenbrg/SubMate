import { EpisodeOrchestrator } from './episode-orchestrator';
import { startNetflixBridge } from './message-bridge';
import { observeNetflixPlayer } from './player-observer';

void (async () => {
  const orchestrator = new EpisodeOrchestrator();
  await orchestrator.initialize();
  const stopBridge = startNetflixBridge({
    onManifest: (snapshot) => orchestrator.handleManifest(snapshot),
    onNavigation: (contentId) => orchestrator.handleNavigation(contentId),
  });
  const stopPlayer = observeNetflixPlayer((video) => orchestrator.setPlayer(video));

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const request = message as Record<string, unknown> | null;
    if (!request || typeof request.type !== 'string' || !request.type.startsWith('CONTENT_')) return false;
    void (async () => {
      switch (request.type) {
        case 'CONTENT_GET_STATE': return orchestrator.getState();
        case 'CONTENT_GET_DEBUG': return orchestrator.getDebugInfo();
        case 'CONTENT_RETRY': return orchestrator.retry();
        case 'CONTENT_ACTIVATE': return orchestrator.activate();
        case 'CONTENT_EXPORT': {
          if (!['json', 'srt', 'vtt'].includes(String(request.format))) throw new TypeError('Invalid export format');
          return orchestrator.exportCurrent(request.format as 'json' | 'srt' | 'vtt');
        }
        case 'CONTENT_IMPORT': {
          if (typeof request.content !== 'string' || typeof request.fileName !== 'string') throw new TypeError('Invalid import');
          return orchestrator.importFile(request.content, request.fileName);
        }
      }
    })().then(
      (value) => sendResponse({ ok: true, value }),
      (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error), code: (error as { code?: string })?.code }),
    );
    return true;
  });

  addEventListener('pagehide', () => {
    stopBridge();
    stopPlayer();
    orchestrator.destroy();
  }, { once: true });
})();
