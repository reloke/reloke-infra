import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OutgoingProfileComponent } from './outgoing-profile.component';

describe('OutgoingProfileComponent', () => {
  let component: OutgoingProfileComponent;
  let fixture: ComponentFixture<OutgoingProfileComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OutgoingProfileComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(OutgoingProfileComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
