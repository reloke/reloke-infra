import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-sparkle-key',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sparkle-key.component.html',
})
export class SparkleKeyComponent {
  @Input() size: string | number = '100';
  @Input() color: string = '#c25e46'; // Default brand color
}
