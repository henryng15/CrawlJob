from job_sync.places import is_united_states


def test_a_state_name_or_code_settles_it() -> None:
    assert is_united_states("New York, NY")
    assert is_united_states("Austin, Texas")
    assert is_united_states("Palo Alto, CA")
    assert is_united_states("Washington, D.C.")


def test_a_bare_us_city_with_no_state_is_kept() -> None:
    """The commonest shape on these boards, and the one the rule is built around:
    nothing in "San Francisco" says United States, and refusing it would drop the
    single largest group of matching roles."""
    assert is_united_states("San Francisco")
    assert is_united_states("Chicago")


def test_a_foreign_city_is_dropped_without_naming_its_country() -> None:
    """Boards write the city alone as often as they write the country, so a list
    of countries by itself would let Munich and Auckland through."""
    assert not is_united_states("Munich")
    assert not is_united_states("London")
    assert not is_united_states("Singapore")
    assert not is_united_states("Auckland, NZ")


def test_a_country_settles_it_where_the_city_is_unknown() -> None:
    assert not is_united_states("Ho Chi Minh, Vietnam")
    assert not is_united_states("Colombia, Remote")


def test_one_us_office_out_of_several_keeps_the_row() -> None:
    """A posting open in two places is one application, and it is applicable if
    either end of it is here. The reading runs over the whole joined string."""
    assert is_united_states("Austin, Texas, United States; South San Francisco, California")
    assert is_united_states("London; Boston, MA")


def test_the_state_beats_the_city_that_shares_its_name() -> None:
    """Vancouver is in Washington as well as in British Columbia, and the US test
    runs first precisely so that the qualified one wins."""
    assert is_united_states("Vancouver, WA")


def test_a_state_code_is_not_read_out_of_lowercase_prose() -> None:
    """IN, OR, ME, OK, HI, DE, LA and PA are all ordinary English words, and the US
    test runs first — so folding case before matching codes would read the
    preposition in "Remote in Europe" as Indiana and keep the row."""
    assert not is_united_states("Remote in Europe")
    assert not is_united_states("Berlin or Munich")


def test_a_region_stands_in_for_a_country() -> None:
    """Boards write the region as often as the country when a role is open across
    several offices, and none of these names anywhere in the US."""
    assert not is_united_states("EMEA")
    assert not is_united_states("Remote, Europe")
    assert not is_united_states("APAC — Remote")


def test_a_substring_is_not_a_country() -> None:
    assert is_united_states("Indianapolis")
    assert is_united_states("Chinatown, San Francisco")


def test_saying_nothing_is_not_saying_abroad() -> None:
    """An empty location is kept. A silent drop is the one failure nobody can
    see — the row simply never appears, and there is nothing to notice."""
    assert is_united_states("")
    assert is_united_states("   ")
    assert is_united_states("Remote")
