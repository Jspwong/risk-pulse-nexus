export class AuthHeaderWidget {
  private container: HTMLElement;

  constructor(_onSignInClick?: () => void, _onSettingsClick?: () => void) {
    this.container = document.createElement('div');
    this.container.className = 'auth-header-widget';
  }

  public getElement(): HTMLElement {
    return this.container;
  }

  public destroy(): void {}
}
