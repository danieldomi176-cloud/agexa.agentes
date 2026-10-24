import type { InferenceAdapter, SalesTask } from '../../../core/src/agexa.js';
import type {
  AgexaKnowledge,
  IntelligenceConfig,
  OllamaStatus,
} from '../../../core/src/intelligence.js';
import { DEFAULT_INTELLIGENCE } from '../../../core/src/intelligence.js';
import { GEMINI_ENDPOINT, GeminiInferenceAdapter } from './gemini.js';
import { OllamaInferenceAdapter, validateIntelligenceConfig } from './ollama.js';

/** Retains the existing configurable adapter boundary, queue and task lifecycle. */
export class ProviderInferenceAdapter extends OllamaInferenceAdapter {
  private readonly local: OllamaInferenceAdapter;
  private readonly cloud: GeminiInferenceAdapter;
  private current: IntelligenceConfig;
  constructor(
    config: IntelligenceConfig,
    mode: 'ollama' | 'test' = 'ollama',
    cloud?: GeminiInferenceAdapter,
  ) {
    super(DEFAULT_INTELLIGENCE, mode);
    this.current = { ...config };
    this.local = new OllamaInferenceAdapter(DEFAULT_INTELLIGENCE, mode);
    this.cloud =
      cloud ??
      new GeminiInferenceAdapter({
        ...DEFAULT_INTELLIGENCE,
        provider: 'gemini',
        baseUrl: GEMINI_ENDPOINT,
        cloudAuthorized: false,
        freeTierConfirmed: false,
        dailyRequestLimit: 20,
      });
    this.configure(config);
  }
  private get selected() {
    return this.current.provider === 'gemini' ? this.cloud : this.local;
  }
  override get name(): string {
    return this.selected.name;
  }
  override get config(): IntelligenceConfig {
    return { ...this.current };
  }
  override get connected(): boolean {
    return this.selected.connected;
  }
  override get status(): OllamaStatus {
    return this.selected.status;
  }
  override configure(config: IntelligenceConfig): void {
    validateIntelligenceConfig(config);
    this.current = { ...config };
    this.selected.configure(config);
  }
  override setKnowledge(reader: () => AgexaKnowledge): void {
    this.local.setKnowledge(reader);
    this.cloud.setKnowledge(reader);
  }
  override probe(): Promise<OllamaStatus> {
    return this.selected.probe();
  }
  override run(
    task: SalesTask,
    context: Parameters<InferenceAdapter['run']>[1],
  ): Promise<Record<string, unknown>> {
    return this.selected.run(task, context);
  }
}
