import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SearcherProfileComponent } from './searcher-profile.component';

describe('SearcherProfileComponent', () => {
  let component: SearcherProfileComponent;
  let fixture: ComponentFixture<SearcherProfileComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SearcherProfileComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(SearcherProfileComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
