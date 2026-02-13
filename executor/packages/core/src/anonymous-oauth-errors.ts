export class OAuthBadRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthBadRequest";
  }
}
