export class StudentKnowledgeModel {
  constructor(predictor = null) {
    this.predictor = predictor;
  }

  async predict(features) {
    if (!this.predictor) {
      return { available: false, reason: 'No trained student knowledge model is configured.' };
    }
    const probability = await this.predictor.predict(features);
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new Error('Student knowledge predictor must return a probability from 0 to 1.');
    }
    return { available: true, probability };
  }
}
