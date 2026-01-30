import { Component, EventEmitter, Output, Input } from '@angular/core';

@Component({
  selector: 'app-logout-button',
  templateUrl: './logout-button.component.html',
  styleUrls: ['./logout-button.component.scss']
})
export class LogoutButtonComponent {
  @Input() collapsed = false;
  @Output() logoutClick = new EventEmitter<void>();

  handleClick() {
    this.logoutClick.emit();
  }
}
